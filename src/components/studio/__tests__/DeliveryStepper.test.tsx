import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryStageControls, ResumeGenerationControls } from '../DeliveryStepper';

describe('DeliveryStageControls', () => {
  const props = {
    pending: false,
    error: null,
    onBack: vi.fn(),
    onRerun: vi.fn(),
  };

  it('does not offer a back path from photo selection to scraping', () => {
    render(<DeliveryStageControls {...props} stage="photo_selection" />);
    expect(screen.queryByText('Back to Scrape')).not.toBeInTheDocument();
  });

  it('does not offer a back path from generating to photo selection', () => {
    render(<DeliveryStageControls {...props} stage="generating" />);
    expect(screen.queryByText('Back to Checkpoint A')).not.toBeInTheDocument();
  });

  it('keeps valid back paths visible for later review stages', () => {
    render(<DeliveryStageControls {...props} stage="checkpoint_a" />);
    expect(screen.getByText('Back to Judge')).toBeInTheDocument();
  });
});

describe('ResumeGenerationControls', () => {
  it('renders a prominent Resume generation button even when no error is set', () => {
    render(<ResumeGenerationControls pending={false} error={null} onResume={vi.fn()} />);
    expect(screen.getByRole('button', { name: /resume generation/i })).toBeEnabled();
  });

  it('fires onResume when clicked', () => {
    const onResume = vi.fn();
    render(<ResumeGenerationControls pending={false} error={null} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: /resume generation/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('disables the button (Resuming…) while a resume request is in flight — prevents double-fire', () => {
    render(<ResumeGenerationControls pending error={null} onResume={vi.fn()} />);
    expect(screen.getByRole('button', { name: /resuming/i })).toBeDisabled();
  });

  it('surfaces a resume error inline in the --le-bad error strip', () => {
    const { container } = render(
      <ResumeGenerationControls pending={false} error="HTTP 502" onResume={vi.fn()} />,
    );
    expect(screen.getByText('HTTP 502')).toBeInTheDocument();
    expect(container.querySelector('.studio-error-strip')).not.toBeNull();
  });
});
