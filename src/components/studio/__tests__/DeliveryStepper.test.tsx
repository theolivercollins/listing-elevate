import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryStageControls } from '../DeliveryStepper';

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
