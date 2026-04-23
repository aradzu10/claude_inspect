import { Session } from '../types';

export const formatSessionDateTime = (mtime?: number): string => {
  if (!mtime) return '';
  const date = new Date(mtime * 1000);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
};

export const getSessionDisplayTitle = (session?: Session | null): string => (
  session?.name || session?.slug || session?.title || session?.id || 'Unknown'
);
