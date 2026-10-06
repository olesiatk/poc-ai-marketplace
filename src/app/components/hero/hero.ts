import { Component, OnDestroy, computed, model, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { ACTIVE_DATASET } from "../../datasets/active";
import { VoiceInput } from "../../lib/voice-input";
import { getSuggestions, type SearchVocabulary, type Suggestion } from "../../lib/suggestions";
import type { PresetQuery } from "../../datasets/dataset.model";
import { normalizeQuery } from "../../lib/ai-results";
import type { AiMode } from "../../models/product.model";

@Component({
  selector: "app-hero",
  imports: [IconComponent],
  templateUrl: "./hero.html",
  styleUrl: "./hero.css",
})
export class HeroComponent implements OnDestroy {
  readonly value = model.required<string>();
  readonly isSearching = input(false);
  readonly statusMessage = input("");
  readonly aiMode = input<AiMode>(null);
  readonly vocabulary = input.required<SearchVocabulary>();
  readonly presets = input<readonly PresetQuery[]>([]);
  /** The query currently shown, so its preset chip can be marked active. */
  readonly activeQuery = input("");

  readonly submitQuery = output<string>();
  readonly howItWorks = output<void>();
  readonly pickPreset = output<string>();
  readonly clearQuery = output<void>();
  /** The visitor is about to type — a cue to start loading what live search needs. */
  readonly searchFocus = output<void>();

  protected readonly placeholder = ACTIVE_DATASET.searchPlaceholder;
  protected readonly voiceError = signal<string | null>(null);
  protected readonly showSuggestions = signal(false);
  protected readonly emptyQueryError = signal(false);

  protected readonly suggestions = computed<Suggestion[]>(() =>
    this.showSuggestions() ? getSuggestions(this.value(), this.vocabulary()) : []
  );

  private readonly voice = new VoiceInput({
    onInterimResult: (transcript) => {
      this.value.set(transcript);
      this.emptyQueryError.set(false);
    },
    onFinalResult: (transcript) => {
      this.value.set(transcript);
      this.emptyQueryError.set(false);
      this.submitQuery.emit(transcript);
    },
    onError: (err) => this.voiceError.set(err),
  });

  protected readonly isListening = this.voice.isListening;
  protected readonly isVoiceSupported = this.voice.isSupported;

  protected readonly modeLabel = computed(() => {
    const mode = this.aiMode();
    // Deliberately no specific model name here — Groq's catalog changes
    // over time (GROQ_MODEL can be swapped independently), so a hardcoded
    // name here would just go stale again.
    if (mode === "groq") return "AI: Groq";
    if (mode === "local") return "Local AI mode";
    return null;
  });

  protected onClear(): void {
    this.value.set("");
    this.showSuggestions.set(false);
    this.clearQuery.emit();
  }

  protected isActivePreset(preset: PresetQuery): boolean {
    return normalizeQuery(preset.query) === normalizeQuery(this.activeQuery());
  }

  ngOnDestroy(): void {
    this.voice.destroy();
  }

  protected onMicClick(): void {
    this.voiceError.set(null);
    if (!this.isVoiceSupported) {
      this.voiceError.set("not-supported");
      return;
    }
    this.isListening() ? this.voice.stop() : this.voice.start();
  }

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
    this.emptyQueryError.set(false);
    // Typing always implies interacting with the field — not just a
    // preceding "focus" DOM event, which won't refire if focus never
    // actually left the input (e.g. right after picking a suggestion).
    this.showSuggestions.set(true);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.showSuggestions.set(false);
    if (!this.value().trim()) {
      this.emptyQueryError.set(true);
      return;
    }
    this.emptyQueryError.set(false);
    this.submitQuery.emit(this.value());
  }

  protected onFocus(): void {
    this.searchFocus.emit();
    this.emptyQueryError.set(false);
    this.showSuggestions.set(true);
  }

  protected onBlur(): void {
    this.showSuggestions.set(false);
  }

  protected onEscape(): void {
    this.showSuggestions.set(false);
  }

  protected selectSuggestion(suggestion: Suggestion): void {
    this.showSuggestions.set(false);
    this.emptyQueryError.set(false);
    this.value.set(suggestion.query);
    this.submitQuery.emit(suggestion.query);
  }

  /** The part of the suggestion the user already typed, for display styling. */
  protected typedPart(suggestion: Suggestion): string {
    return suggestion.query.slice(0, suggestion.query.length - suggestion.completion.length);
  }
}
