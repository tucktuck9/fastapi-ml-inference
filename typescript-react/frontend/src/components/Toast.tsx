import type { JSX } from 'react';

interface ToastProps {
  message: string;
  visible: boolean;
}

// ------------------------------------------ //
//             COMPONENT                      //
// ------------------------------------------ //

export default function Toast({ message, visible }: ToastProps): JSX.Element {
  return (
    <div
      className={`toast${visible ? ' show' : ''}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
