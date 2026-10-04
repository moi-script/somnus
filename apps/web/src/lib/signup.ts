/** Why a new account's password would be refused, in words for the form; null when fine. */
export function signupProblem(password: string, confirm: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
