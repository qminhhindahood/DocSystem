import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}

describe('test harness', () => {
  it('renders a button with accessible name', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });
});
