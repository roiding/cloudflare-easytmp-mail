import { useState, useCallback, useRef, useEffect } from 'react';

export function useClipboard(timeout = 2000) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // Fallback using textarea execCommand
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          textarea.style.top = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }

        setCopiedText(text);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          setCopiedText(null);
          timerRef.current = null;
        }, timeout);
        return true;
      } catch (err) {
        console.error('Failed to copy to clipboard', err);
        return false;
      }
    },
    [timeout],
  );

  return { copy, copiedText };
}
