/** Métodos que modifican datos: exigen protección CSRF y verificación de origen. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
