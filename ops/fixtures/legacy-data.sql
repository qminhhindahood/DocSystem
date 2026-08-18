INSERT INTO "User" VALUES
('10000000-0000-4000-8000-000000000001','fixture-user','!disabled-fixture!','user',true,NOW(),NOW());
INSERT INTO "UserLLMConfig" VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','lmstudio','http://localhost:1234','fixture-model','x','x','x',NOW(),NOW());
INSERT INTO "Document" VALUES
('30000000-0000-4000-8000-000000000001','cong-van','1','Fixture one','One','published',NOW(),NOW(),NOW()),
('30000000-0000-4000-8000-000000000002','quyet-dinh','2','Fixture two','Two','draft',NOW(),NOW(),NULL);
INSERT INTO "Chunk" VALUES
('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Điều 1',NULL,NULL,'Chunk one',NULL,NOW()),
('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',2,'Điều 1','Khoản 1',NULL,'Chunk two',NULL,NOW()),
('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002',1,'Điều 2',NULL,NULL,'Chunk three',NULL,NOW());
INSERT INTO "Feedback" ("id","documentId","originalContent","editedContent","diff","approvedForTraining","approvedForRag","reviewStatus","createdAt") VALUES
('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','old','new','{}',false,false,'pending',NOW());
INSERT INTO "Template" VALUES
('60000000-0000-4000-8000-000000000001','Fixture template','cong-van','Header','Signature',true,NOW(),NOW());
INSERT INTO "TrainingJob" VALUES
('70000000-0000-4000-8000-000000000001','fixture-job','completed',50,1,'{}',100,1,1,NOW(),NOW());
INSERT INTO "ModelVersion" VALUES
('80000000-0000-4000-8000-000000000001','fixture-base','fixture-v1','candidate',false,'70000000-0000-4000-8000-000000000001',1,NOW(),NOW());
