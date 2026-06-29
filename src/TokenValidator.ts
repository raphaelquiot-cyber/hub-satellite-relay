/**
 * TokenValidator — vérifie les tokens de connexion au relais.
 *
 * Placeholder intentionnel : la validation est volontairement minimale.
 * Plug futur prévu ici : HMAC-SHA256 signé avec un secret partagé
 * entre le Hub et le relais, ou JWT avec expiration courte.
 *
 * Format attendu aujourd'hui : string alphanumérique ≥ 32 caractères.
 * Générer avec : node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
 */
export class TokenValidator {
  private static readonly MIN_LENGTH = 32

  isValid(token: string): boolean {
    if (token.length < TokenValidator.MIN_LENGTH) return false
    // Caractères autorisés : hex, base64url, UUID sans tirets
    return /^[a-zA-Z0-9_\-]+$/.test(token)
  }
}
