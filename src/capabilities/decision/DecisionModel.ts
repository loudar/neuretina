/**
 * Generic decision models: a state (text) plus a typed question, answered
 * with a calibrated choice. Laya is one provider; anything implementing this
 * interface (a local ONNX model, a remote classifier, …) can categorize
 * events without the rest of the app knowing which backend runs.
 */
export interface ChoiceQuestion {
  /** What the model should decide, e.g. "Pick the best event tag". */
  instructions: string;
  /** Option key -> criteria description shown to the model. */
  options: Record<string, string>;
}

export interface ChoiceAnswer {
  /** Selected option key. */
  choice: string;
  /** Confidence in [0, 1] as reported by the model. */
  confidence: number;
  /** Full distribution over the option keys. */
  probabilities: Record<string, number>;
}

export interface DecisionModel {
  readonly name: string;
  /** False when the backend is not installed/configured; callers fall back. */
  available(): Promise<boolean>;
  choose(state: string, question: ChoiceQuestion): Promise<ChoiceAnswer>;
}

/** Registry so workflows resolve decision models by name. */
export class DecisionModelRegistry {
  private readonly models = new Map<string, DecisionModel>();

  register(model: DecisionModel): void {
    this.models.set(model.name, model);
  }

  get(name: string): DecisionModel | undefined {
    return this.models.get(name);
  }

  list(): DecisionModel[] {
    return [...this.models.values()];
  }
}
