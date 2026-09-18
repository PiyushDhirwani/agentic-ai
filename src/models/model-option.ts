/** A selectable model, as the catalogue stores it. */
export interface ModelOption {
  /** The OpenRouter model id, e.g. "nvidia/nemotron-3.5-lightning:free". */
  id: string;
  label: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  notes: string | null;
}

/**
 * What the app needs to serve a turn: which model to try first, the order to
 * fall back through, and what to offer in the picker.
 */
export interface ModelCatalogue {
  defaultModel: string;
  /** Enabled models in fallback order. */
  chain: string[];
  options: ModelOption[];
  /** True when this came from env because the table was empty or unreachable. */
  fromBootstrap: boolean;
}
