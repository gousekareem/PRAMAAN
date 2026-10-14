import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FreshnessBadge, StatusBadge, freshnessText } from '../components/ui/Badges';
import { Pagination } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { ApiError } from '../services/api';
import { VerificationSummary } from '../pages/EvidenceDetailPage';
import type { EvidenceDetail } from '../services/types';

describe('status labels', () => {
  it('never describes an observation as "live"', () => {
    for (const label of Object.keys(freshnessText) as (keyof typeof freshnessText)[]) {
      const { unmount } = render(<FreshnessBadge label={label} />);
      expect(document.body.textContent?.toLowerCase()).not.toContain('live');
      unmount();
    }
    render(<FreshnessBadge label="OFFLINE_LAST_KNOWN" />);
    expect(screen.getByText('Offline; last observation known')).toBeInTheDocument();
  });
  it('labels evidence states explicitly', () => {
    render(
      <>
        <StatusBadge value="VERIFIED" />
        <StatusBadge value="QUARANTINED" />
      </>,
    );
    expect(screen.getByText('Evidence verified')).toBeInTheDocument();
    expect(screen.getByText('Evidence rejected (quarantined)')).toBeInTheDocument();
  });
});

describe('state components', () => {
  it('shows loading and API errors with request id', async () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    const retry = vi.fn();
    render(
      <ErrorState error={new ApiError(500, 'INTERNAL_ERROR', 'Boom', 'req-123')} onRetry={retry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('req-123');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
  it('paginates', async () => {
    const onPage = vi.fn();
    render(<Pagination page={2} totalPages={3} total={60} onPage={onPage} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPage.mock.calls).toEqual([[3], [1]]);
  });
  it('disables previous on the first page', () => {
    render(<Pagination page={1} totalPages={1} total={0} onPage={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('evidence verification display', () => {
  const base = {
    imageSha256: 'a'.repeat(64),
    computedImageSha256: 'a'.repeat(64),
    status: 'VERIFIED',
  } as EvidenceDetail;
  it('shows verified integrity but warns that integrity is not authenticity', () => {
    render(<VerificationSummary d={base} />);
    expect(screen.getByRole('status')).toHaveTextContent('Integrity verified');
    expect(screen.getByRole('status')).toHaveTextContent('Integrity ≠ authenticity');
  });
  it('shows rejected evidence', () => {
    render(
      <VerificationSummary
        d={{ ...base, status: 'QUARANTINED', computedImageSha256: 'b'.repeat(64) }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Evidence rejected');
  });
  it('shows awaiting upload', () => {
    render(
      <VerificationSummary d={{ ...base, status: 'AWAITING_UPLOAD', computedImageSha256: null }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Awaiting evidence upload');
  });
});
