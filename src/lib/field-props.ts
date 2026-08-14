/**
 * The props a documented field accepts.
 *
 * Declared once because three components share them: `Field` renders them, and
 * `ParamField` and `ResponseField` are the author-facing names that forward
 * them. Restating the list in each was how they drifted — `ResponseField`
 * accepted `pre`/`post` and `ParamField` did not, though both reached the same
 * renderer, so the difference existed only in the types.
 */
export interface FieldProps {
  name?: string;
  type?: string;
  required?: boolean;
  deprecated?: boolean;
  default?: string | number | boolean;
  /** Alias for `default`, for specs that name it this way. */
  initialValue?: string | number | boolean;
  placeholder?: string;
  /** Extra pills before the name, e.g. a scope or a location. */
  pre?: string[];
  /** Extra pills after the name. */
  post?: string[];
  /** Shown as a further pill, e.g. an enum hint. */
  hint?: string;
}
