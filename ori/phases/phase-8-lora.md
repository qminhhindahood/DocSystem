# Phase 8: LoRA Fine-tuning for State Document Tone

## 8.1 Why LoRA?

- **Parameter Efficient**: Only trains 0.1-2% of model parameters (adapter matrices)
- **Fast**: Hours vs days for full fine-tuning
- **Reversible**: Keep base model intact, swap adapters per use case
- **Small size**: 14B model + ~100MB LoRA vs 14B fine-tuned = 28GB

## 8.2 Training Data Preparation

### Dataset Format
```jsonl
{"messages": [{"role": "user", "content": "Soạn thảo công văn yêu cầu báo cáo tình hình học sinh"}, {"role": "assistant", "content": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n---\nSố: ...\nV/v: Yêu cầu báo cáo..."}]}
{"messages": [{"role": "user", "content": "Lập kế hoạch cho quyết định thành lập hội đồng"}, {"role": "assistant", "content": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\n...\nQUYẾT ĐỊNH\n...\nĐiều 1. Thành lập Hội đồng..."}]}
```

### Data Collection Strategy

1. **Seed Examples**: 200-500 manually written state documents
   - Real examples from Nghị định 30/2020
   - Cover all document types: công văn, quyết định, thông báo, nghị quyết

2. **Synthetic Augmentation**: Generate variations using Qwen itself
   ```python
   # backend/services/synth_data.py
   def generate_synthetic_examples(base_doc: str, num_variations: int = 5) -> List[str]:
       """Generate synthetic training examples from seed documents."""
       variations = []
       for _ in range(num_variations):
           prompt = f"""
           Dựa vào văn bản sau, hãy viết lại với các thay đổi nhỏ về cách diễn đạt,
           nhưng giữ nguyên cấu trúc pháp lý và thông tin:

           {base_doc[:2000]}

           Hãy viết lại:
           """
           response = ollama.generate(prompt)
           variations.append(response)
       return variations
   ```

3. **Feedback Integration**: Convert user feedback to training pairs
   ```python
   def feedback_to_training(feedback: Feedback) -> Dict:
       """Convert feedback diff to training example."""
       return {
           "messages": [
               {"role": "user", "content": feedback.original_prompt},
               {"role": "assistant", "content": feedback.edited_doc}
           ]
       }
   ```

### Dataset Statistics Target
- **Minimum**: 500 examples
- **Target**: 2,000-5,000 examples
- **Maximum**: 10,000 (beyond this, diminishing returns)

## 8.3 Training Setup with Unsloth (Recommended)

Unsloth is 2x faster than vanilla PEFT and uses less memory.

```bash
# Create training environment
conda create -n lora-train python=3.10 -y
conda activate lora-train

# Install dependencies
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install transformers datasets peft accelerate bitsandbytes
pip install unsloth  # Faster LoRA training
pip install trl  # Training reinforcement learning helpers
pip install sentencepiece  # For tokenization
pip install huggingface-hub
```

### Training Script

```python
# backend/fine-tuning/train_lora.py
import torch
from unsloth import FastLanguageModel
from transformers import TrainingArguments
from trl import SFTTrainer
from datasets import Dataset
import json

# Configuration
MODEL_NAME = "Qwen/Qwen3.6-14B"
MAX_SEQ_LENGTH = 8192  # Extended context for Qwen3.6
LOAD_IN_4BIT = True  # 4-bit quantization for memory efficiency

# LoRA configuration
LORA_R = 16  # Rank
LORA_ALPHA = 32  # Alpha scaling
LORA_DROPOUT = 0.1
LORA_TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj"
]

def load_model():
    """Load model with 4-bit quantization."""
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,  # Auto detect
        load_in_4bit=LOAD_IN_4BIT,
        # trust_remote_code=True if needed
    )

    # Apply LoRA
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_R,
        target_modules=LORA_TARGET_MODULES,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        bias="none",
        use_gradient_checkpointing=True,
        random_state=3407,
    )

    return model, tokenizer

def prepare_dataset(data_path: str) -> Dataset:
    """Load and format training data."""
    with open(data_path, 'r', encoding='utf-8') as f:
        examples = [json.loads(line) for line in f]

    def formatting_prompts_func(examples):
        texts = []
        for messages in examples["messages"]:
            # Apply chat template
            text = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False
            )
            texts.append(text)
        return {"text": texts}

    dataset = Dataset.from_list(examples)
    dataset = dataset.map(formatting_prompts_func, batched=True)

    return dataset

def train():
    """Main training loop."""
    model, tokenizer = load_model()
    dataset = prepare_dataset("data/training_dataset.jsonl")

    training_args = TrainingArguments(
        output_dir="./lora-adapter",
        overwrite_output_dir=True,
        num_train_epochs=3,
        per_device_train_batch_size=1,  # Adjust based on VRAM
        gradient_accumulation_steps=8,
        gradient_checkpointing=True,
        optim="adamw_torch_fused",
        logging_steps=10,
        save_strategy="epoch",
        learning_rate=2e-4,
        bf16=True,  # Use bfloat16 if GPU supports it
        fp16=False,  # Don't use fp16 with 4-bit
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        report_to="none",  # or "wandb"
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        packing=True,  # Pack multiple sequences together
        args=training_args,
    )

    trainer.train()

    # Save LoRA adapter
    trainer.save_model("./lora-adapter-final")

    # Merge with base model (optional)
    model.save_pretrained_merged("./merged-model", tokenizer, save_method="merged_16bit")

if __name__ == "__main__":
    train()
```

### Training on 8GB VRAM

```bash
# With 8GB VRAM and 4-bit quantization:
# - Qwen3.6-14B fits in ~6GB
# - Batch size of 1 with gradient accumulation 8
# - Max sequence 2048 (safe) or 4096-8192 (may OOM, adjust as needed)

# Monitor GPU
watch -n 1 nvidia-smi

# Start training
python train_lora.py
```

## 8.4 Converting LoRA to Ollama Format

```bash
# After training, create Ollama-compatible Modelfile

# backend/fine-tuning/export_to_ollama.py
import os

def create_ollama_modelfile(lora_path: str, base_model: str, output_path: str):
    """Create Modelfile for Ollama with LoRA adapter."""

    modelfile = f"""FROM {base_model}

# LoRA adapter path (must be accessible to Ollama)
ADAPTER {lora_path}

# System prompt for state documents
SYSTEM \"\"\"
{open('system_prompt_vn.txt').read()}
\"\"\"

PARAMETER temperature 0.3
PARAMETER num_ctx 4096
"""

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(modelfile)

    print(f"Created Modelfile at {output_path}")
    print("To create Ollama model:")
    print(f"  ollama create airabbit-finetuned -f {output_path}")

# Usage
create_ollama_modelfile(
    lora_path="./lora-adapter-final",
    base_model="qwen3.6:14b",
    output_path="./Modelfile-finetuned"
)
```

### Load Fine-tuned Model

```bash
# Create custom model
ollama create airabbit-lora -f Modelfile-finetuned

# Test it
ollama run airabbit-lora "Soạn thảo quyết định thành lập ban chỉ đạo"

# Switch backend to use fine-tuned model
# Update backend config:
# OLLAMA_MODEL = "airabbit-lora"
```

## 8.5 Evaluation Metrics

```python
# backend/fine-tuning/evaluate.py
from evaluate import load
import json

rouge = load("rouge")
bertscore = load("bertscore")

def evaluate_model(generated: str, reference: str) -> Dict:
    """Evaluate fine-tuned model outputs."""

    # ROUGE scores
    rouge_result = rouge.compute(
        predictions=[generated],
        references=[reference],
        tokenizer=lambda x: x.split(),  # Simple whitespace tokenizer for Vietnamese
        use_stemmer=True
    )

    # BERTScore (semantic similarity)
    bertscore_result = bertscore.compute(
        predictions=[generated],
        references=[reference],
        lang="vi"  # Vietnamese
    )

    # Format compliance (Decree 30/2020)
    format_score = check_format_compliance(generated)

    return {
        "rouge1": rouge_result["rouge1"],
        "rouge2": rouge_result["rouge2"],
        "rougeL": rouge_result["rougeL"],
        "bertscore_f1": bertscore_result["f1"][0],
        "format_compliance": format_score,
    }

def check_format_compliance(doc: str) -> float:
    """Check if document follows Decree 30/2020 format."""
    required_elements = [
        r'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
        r'Số:\s*\w+',
        r'(Hà Nội|TP\. HCM|Đà Nẵng),.*ngày',
        r'(Ký tên|Nơi nhận|Chữ ký)'
    ]

    score = sum(1 for p in required_elements if re.search(p, doc, re.IGNORECASE))
    return score / len(required_elements)
```

## 8.6 Continuous Fine-tuning Pipeline

```python
# backend/services/continuous_finetune.py
class ContinuousFineTuner:
    """
    Automatically fine-tune based on accumulated feedback.
    """

    def __init__(self):
        self.min_examples_per_type = 50
        self.queue = []

    async def maybe_trigger_finetune(self):
        """Check if we have enough examples for fine-tuning."""
        counts = await self.get_feedback_counts()

        for edit_type, count in counts.items():
            if count >= self.min_examples_per_type:
                await self.start_finetune_job(edit_type, count)

    async def start_finetune_job(self, edit_type: str, count: int):
        """Launch fine-tuning job for specific edit type."""
        # 1. Export feedback to training format
        dataset_path = f"./data/finetune_{edit_type}_{datetime.now().strftime('%Y%m%d')}.jsonl"
        await self.export_feedback_dataset(edit_type, dataset_path)

        # 2. Submit training job (could be separate process/container)
        job_id = await self.submit_training_job(
            dataset=dataset_path,
            edit_type=edit_type,
            base_model="Qwen/Qwen3.6-14B"
        )

        # 3. Track job status
        await self.track_job(job_id)

    async def export_feedback_dataset(self, edit_type: str, output_path: str):
        """Export feedback to JSONL format."""
        feedbacks = await self.db.feedback.find_many(
            where={"editType": edit_type, "usedInTraining": {"not": True}}
        )

        with open(output_path, 'w', encoding='utf-8') as f:
            for fb in feedbacks:
                example = {
                    "messages": [
                        {"role": "user", "content": fb.prompt},
                        {"role": "assistant", "content": fb.editedContent}
                    ]
                }
                f.write(json.dumps(example, ensure_ascii=False) + '\n')

        print(f"Exported {len(feedbacks)} examples to {output_path}")
```

### Cron Job for Fine-tuning
```bash
# Check weekly and fine-tune if needed
0 2 * * 0 cd /path/to/backend && python -m services.continuous_finetune
```
