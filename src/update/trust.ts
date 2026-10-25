/**
 * Pinned release-authentication keys.
 *
 * The release workflow signs SHA256SUMS with an SSH key in the `file-release`
 * namespace. Only the public key lives here and in `.forgejo/allowed_signers`;
 * the private key is a Forgejo secret stored in the cold-at vault as
 * `wze-websearch/release-signing-key`.
 *
 * Rotation: add the new public key to this array and commit it before the
 * release signed by that key. Existing clients keep trusting both keys, so the
 * next update can move them onto the new key.
 */
export const RELEASE_PUBLIC_KEYS: readonly string[] = [
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHeqGDJAqSVRpHrWfam2lsecAEXZ471HrcbQQoY4t2xW wze-websearch-release",
];
