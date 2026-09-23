/** Atributos ARIA para un control dentro de <Field>. */
export function fieldAria(id: string, error?: string | null, hasHint = false) {
  const invalid = error !== null && error !== undefined && error.length > 0;
  const describedBy = invalid ? `${id}-error` : hasHint ? `${id}-hint` : undefined;
  return {
    id,
    'aria-invalid': invalid || undefined,
    ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
  };
}
