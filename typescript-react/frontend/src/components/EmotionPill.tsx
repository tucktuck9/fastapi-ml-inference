import type { JSX } from 'react';
import { emojiFor } from '../utils/display';
import type { Emotion } from '../types';

interface EmotionPillProps {
  emotion: Emotion;
  rank?: number;
}

// ------------------------------------------ //
//             COMPONENT                      //
// ------------------------------------------ //

export default function EmotionPill({ emotion, rank = 99 }: EmotionPillProps): JSX.Element {
  return (
    <span className={`reaction${rank === 0 ? ' rank-0' : ''}`}>
      <span className="reaction-emoji">{emojiFor(emotion.label)}</span>
      <span className="reaction-label">{emotion.label}</span>
      <span className="reaction-score">{(emotion.score * 100).toFixed(0)}%</span>
    </span>
  );
}
