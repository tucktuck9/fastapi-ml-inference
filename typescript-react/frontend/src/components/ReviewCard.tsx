import type { JSX } from 'react';
import EmotionPill from './EmotionPill';
import type { Review } from '../types';

interface ReviewCardProps {
  review: Review;
}

// ------------------------------------------ //
//             COMPONENT                      //
// ------------------------------------------ //

export default function ReviewCard({ review }: ReviewCardProps): JSX.Element {
  return (
    <article className="review-card">
      <div className="review-head">
        <span className="review-author">{review.author ?? 'Anonymous'}</span>
        {review.rating != null && (
          <span className="review-rating">
            <span className="star">★</span>{review.rating}/10
          </span>
        )}
      </div>
      <div className="review-content">{review.content ?? ''}</div>
      <div className="reactions">
        {(review.emotions ?? []).map((e, i) => (
          <EmotionPill key={e.label} emotion={e} rank={i} />
        ))}
      </div>
    </article>
  );
}
