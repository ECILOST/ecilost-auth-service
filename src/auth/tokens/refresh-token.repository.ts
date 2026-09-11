export interface StoredRefreshToken {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface NewRefreshToken {
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
}

/** Puerto de salida hacia el almacen de sesiones. */
export interface RefreshTokenRepository {
  create(token: NewRefreshToken): Promise<void>;

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;

  /**
   * Marca el token como usado, pero **solo si seguia vigente**. Devuelve false cuando
   * otra peticion se le adelanto. Es lo que convierte la deteccion de reuso en una
   * comprobacion atomica en lugar de un leer-y-despues-escribir con carrera.
   */
  consume(id: string): Promise<boolean>;

  /** Revoca la cadena completa de rotacion. Se dispara al detectar un reuso. */
  revokeFamily(familyId: string): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('RefreshTokenRepository');
