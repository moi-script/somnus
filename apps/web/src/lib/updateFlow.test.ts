import { describe, expect, it } from 'vitest';
import { downloadLabel, updateErrorText } from './updateFlow';

const MB = 1024 * 1024;

describe('downloadLabel', () => {
  it('shows progress against the size when the server sends it', () => {
    expect(downloadLabel(12.4 * MB, 19 * MB)).toBe('Downloading 12 / 19 MB');
  });

  it('shows what has arrived when the size is unknown', () => {
    expect(downloadLabel(3 * MB, 0)).toBe('Downloading 3 MB');
  });

  it('starts at zero rather than nothing', () => {
    expect(downloadLabel(0, 0)).toBe('Starting the download…');
  });
});

describe('updateErrorText', () => {
  it('explains a failed download', () => {
    expect(updateErrorText('download', new Error('Unable to resolve host'))).toBe(
      'The download did not finish. Check the internet connection and try again.',
    );
  });

  it('explains a blocked installer', () => {
    expect(updateErrorText('install', new Error('Activity not found'))).toBe(
      'The installer did not open. Allow Somnus to install apps in Android settings, or download it in the browser.',
    );
  });
});
