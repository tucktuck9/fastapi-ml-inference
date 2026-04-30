import type { JSX } from 'react';

// ------------------------------------------ //
//             COMPONENT                      //
// ------------------------------------------ //

export default function ReviewSkeleton(): JSX.Element {
  return (
    <div className="review-skeleton">
      <div className="skeleton sk-line sk-author" />
      <div className="skeleton sk-line sk-text-1" />
      <div className="skeleton sk-line sk-text-2" />
      <div className="skeleton sk-line sk-chips" />
    </div>
  );
}
