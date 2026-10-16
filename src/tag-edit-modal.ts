import { App, Modal, Setting, setIcon } from "obsidian";
import { Tags } from "./tags";
import { relativeLuminance } from "./color-utils";

export class TagEditModal extends Modal {
  private tags: string[];
  private tagsManager: Tags;
  private onSubmit: (tags: string[]) => void;
  // Tags offered as toggle pills: the board's tags plus any typed in this session
  private knownTags: string[];
  private suggestionsEl!: HTMLElement;
  private inputContainerEl!: HTMLElement;
  private inputEl!: HTMLInputElement;

  constructor(
    app: App,
    tags: string[],
    tagsManager: Tags,
    onSubmit: (tags: string[]) => void,
  ) {
    super(app);
    this.tags = [...tags]; // Copy
    this.tagsManager = tagsManager;
    this.onSubmit = onSubmit;
    this.knownTags = tagsManager.getBoardTags();
    for (const tag of this.tags) {
      if (!this.knownTags.includes(tag)) this.knownTags.push(tag);
    }
  }

  onOpen() {
    this.modalEl.addClass("base-board-tag-modal");
    this.titleEl.setText("Edit tags");

    this.contentEl.createEl("p", {
      text: "Click a tag to toggle it, or type a new one and press enter or comma. Press backspace to remove.",
      cls: "setting-item-description",
    });

    this.suggestionsEl = this.contentEl.createDiv({
      cls: "base-board-tag-suggestions",
    });

    // Container acts as the visual "input box"
    this.inputContainerEl = this.contentEl.createDiv({
      cls: "base-board-tag-input-container",
    });

    // The actual text input
    this.inputEl = this.inputContainerEl.createEl("input", {
      type: "text",
      cls: "base-board-tag-input",
      placeholder: "Add tag...",
    });

    // Support focusing input when clicking anywhere inside the faux-input container
    this.inputContainerEl.addEventListener("click", () => {
      this.inputEl.focus();
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        this.addTag(this.inputEl.value.trim());
        this.inputEl.value = "";
        this.renderTags();
      } else if (e.key === "Backspace" && this.inputEl.value === "") {
        if (this.tags.length > 0) {
          this.tags.pop();
          this.renderTags();
        }
      }
    });

    this.renderTags();

    const actionsContainer = this.contentEl.createDiv({
      cls: "base-board-modal-actions-right",
    });

    new Setting(actionsContainer).addButton((btn) => {
      btn
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          // Flush any pending text before save
          this.addTag(this.inputEl.value.trim());
          this.close();
          this.onSubmit(this.tags);
        });
    });

    window.setTimeout(() => this.inputEl.focus(), 50);
  }

  private addTag(tag: string) {
    if (!tag || this.tags.includes(tag)) return;
    this.tags.push(tag);
    if (!this.knownTags.includes(tag)) this.knownTags.push(tag);
  }

  private renderTags() {
    // Clear all existing tags (but keep the input!)
    const existingTags = this.inputContainerEl.querySelectorAll(
      ".base-board-tag-chip",
    );
    existingTags.forEach((el) => el.remove());

    // Insert new tags BEFORE the input element
    this.tags.forEach((tag) => {
      const chipEl = this.inputContainerEl.createDiv({
        cls: "base-board-tag-chip",
      });
      chipEl.createSpan({ text: tag, cls: "base-board-tag-chip-text" });

      const color = this.tagsManager.getColorForTag(tag);
      if (color) {
        chipEl.style.setProperty("--tag-color", color);
        if (relativeLuminance(color) === "dark") {
          chipEl.addClass("base-board-tag-chip-light");
        } else {
          chipEl.addClass("base-board-tag-chip-dark");
        }
      }

      const removeBtn = chipEl.createSpan({
        cls: "base-board-tag-chip-remove",
      });
      setIcon(removeBtn, "lucide-x");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.tags = this.tags.filter((t) => t !== tag);
        this.renderTags();
        this.inputEl.focus();
      });

      this.inputContainerEl.insertBefore(chipEl, this.inputEl);
    });

    this.renderSuggestions();
  }

  private renderSuggestions() {
    this.suggestionsEl.empty();

    for (const tag of this.knownTags) {
      const pill = this.tagsManager.createTagPill(this.suggestionsEl, tag);
      pill.toggleClass("is-active", this.tags.includes(tag));

      pill.addEventListener("click", () => {
        if (this.tags.includes(tag)) {
          this.tags = this.tags.filter((t) => t !== tag);
        } else {
          this.tags.push(tag);
        }
        this.renderTags();
        this.inputEl.focus();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
