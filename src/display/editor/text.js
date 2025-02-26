import {
  AnnotationEditorType,
  assert, uuid,
  LINE_FACTOR, shadow,
  Util,
} from "../../shared/util.js";
import {AnnotationEditor} from "./editor.js";
import {
  CustomTextWidgetAnnotationElement
} from "../annotation_layer.js";
import {
  AnnotationEditorUIManager,
  bindEvents,
  KeyboardManager
} from "./tools.js";

class TextEditor extends AnnotationEditor {

  #color;

  #editorDivId = `${this.id}-editor`;

  #editModeAC = null;

  #fontSize = 8;

  static _type = "textEditor";

  static _editorType = AnnotationEditorType.TEXT;

  static get _keyboardManager() {
    const proto = TextEditor.prototype;

    const arrowChecker = self => self.isEmpty();

    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;

    return shadow(
      this,
      "_keyboardManager",
      new KeyboardManager([
        [
          // Commit the text in case the user use ctrl+s to save the document.
          // The event must bubble in order to be caught by the viewer.
          // See bug 1831574.
          ["ctrl+s", "mac+meta+s", "ctrl+p", "mac+meta+p"],
          proto.commitOrRemove,
          { bubbles: true },
        ],
        [
          ["ctrl+Enter", "mac+meta+Enter", "Escape", "mac+Escape"],
          proto.commitOrRemove,
        ],
        [
          ["ArrowLeft", "mac+ArrowLeft"],
          proto._translateEmpty,
          { args: [-small, 0], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowLeft", "mac+shift+ArrowLeft"],
          proto._translateEmpty,
          { args: [-big, 0], checker: arrowChecker },
        ],
        [
          ["ArrowRight", "mac+ArrowRight"],
          proto._translateEmpty,
          { args: [small, 0], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowRight", "mac+shift+ArrowRight"],
          proto._translateEmpty,
          { args: [big, 0], checker: arrowChecker },
        ],
        [
          ["ArrowUp", "mac+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -small], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowUp", "mac+shift+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -big], checker: arrowChecker },
        ],
        [
          ["ArrowDown", "mac+ArrowDown"],
          proto._translateEmpty,
          { args: [0, small], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowDown", "mac+shift+ArrowDown"],
          proto._translateEmpty,
          { args: [0, big], checker: arrowChecker },
        ],
      ])
    );
  }

  constructor(params) {
    super({ ...params, name: "textEditor" });
    this.#color = '#000000';
    this.#fontSize = 12;
    this.height = params.defaultHeight;
    this.width = params.defaultWidth;
  }

  /** @inheritdoc */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    const style = getComputedStyle(document.documentElement);

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      const lineHeight = parseFloat(
        style.getPropertyValue("--freetext-line-height")
      );
      assert(
        lineHeight === LINE_FACTOR,
        "Update the CSS variable to agree with the constant."
      );
    }

    this._internalPadding = parseFloat(
      style.getPropertyValue("--freetext-padding")
    );
  }

  /**
   * Helper to translate the editor with the keyboard when it's empty.
   * @param {number} x in page units.
   * @param {number} y in page units.
   */
  _translateEmpty(x, y) {
    this._uiManager.translateSelectedEditors(x, y, /* noCommit = */ true);
  }

  /** @inheritdoc */
  getInitialTranslation() {
    // The start of the base line is where the user clicked.
    const scale = this.parentScale;
    return [
      -TextEditor._internalPadding * scale,
      -(TextEditor._internalPadding + this.#fontSize) * scale,
    ];
  }


  /** @inheritdoc */
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  /** @inheritdoc */
  enableEditMode() {
    if (this.isInEditMode()) {
      return;
    }

    this.parent.setEditingState(false);
    this.parent.updateToolbar(AnnotationEditorType.TEXT);
    super.enableEditMode();
    this.overlayDiv.classList.remove("enabled");
    this._isDraggable = false;
    this.div.removeAttribute("aria-activedescendant");

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        !this.#editModeAC,
        "No `this.#editModeAC` AbortController should exist."
      );
    }
    this.#editModeAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#editModeAC);

    this.editorDiv.addEventListener(
      "keydown",
      this.editorDivKeydown.bind(this),
      { signal }
    );
    this.editorDiv.addEventListener("focus", this.editorDivFocus.bind(this), {
      signal,
    });
    this.editorDiv.addEventListener("blur", this.editorDivBlur.bind(this), {
      signal,
    });
    this.editorDiv.addEventListener("input", this.editorDivInput.bind(this), {
      signal,
    });
    this.editorDiv.addEventListener("paste", this.editorDivPaste.bind(this), {
      signal,
    });
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode()) {
      return;
    }

    this.parent.setEditingState(true);
    super.disableEditMode();
    this.overlayDiv.classList.add("enabled");
    this.div.setAttribute("aria-activedescendant", this.#editorDivId);
    this._isDraggable = true;

    this.#editModeAC?.abort();
    this.#editModeAC = null;

    // On Chrome, the focus is given to <body> when contentEditable is set to
    // false, hence we focus the div.
    this.div.focus({
      preventScroll: true /* See issue #15744 */,
    });

    // In case the blur callback hasn't been called.
    this.isEditing = false;
    this.parent.div.classList.add("textEditing");
  }

  /** @inheritdoc */
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    if (event.target !== this.editorDiv) {
      this.editorDiv.focus();
    }
  }

  /** @inheritdoc */
  onceAdded(focus) {
    if (this.width) {
      // The editor was created in using ctrl+c.
      return;
    }
    this.enableEditMode();
    if (focus) {
      this.editorDiv.focus();
    }
    if (this._initialOptions?.isCentered) {
      this.center();
    }
    this._initialOptions = null;
    this.commitOrRemove();
  }

  /** @inheritdoc */
  isEmpty() {
    return !this.editorDiv;
  }

  /** @inheritdoc */
  remove() {
    this.isEditing = false;
    if (this.parent) {
      this.parent.setEditingState(true);
      this.parent.div.classList.add("textEditing");
    }
    super.remove();
    this._uiManager.notifyAnnotationEditorRemoved(this);
  }


  #setEditorDimensions() {
    const [parentWidth, parentHeight] = this.parentDimensions;

    let rect;
    if (this.isAttachedToDOM) {
      rect = this.div.getBoundingClientRect();
    } else {
      // This editor isn't on screen but we need to get its dimensions, so
      // we just insert it in the DOM, get its bounding box and then remove it.
      const { currentLayer, div } = this;
      const savedDisplay = div.style.display;
      const savedVisibility = div.classList.contains("hidden");
      div.classList.remove("hidden");
      div.style.display = "hidden";
      currentLayer.div.append(this.div);
      rect = div.getBoundingClientRect();
      div.remove();
      div.style.display = savedDisplay;
      div.classList.toggle("hidden", savedVisibility);
    }

    // The dimensions are relative to the rotation of the page, hence we need to
    // take that into account (see issue #16636).
    if (this.rotation % 180 === this.parentRotation % 180) {
      this.width = rect.width / parentWidth;
      this.height = rect.height / parentHeight;
    } else {
      this.width = rect.height / parentWidth;
      this.height = rect.width / parentHeight;
    }
    this.fixAndSetPosition();
  }

  /**
   * Commit the content we have in this editor.
   * @returns {undefined}
   */
  commit() {
    console.log('Perform commit');
    if (!this.isInEditMode()) {
      return;
    }
    super.commit();
    this.disableEditMode();
    this._uiManager.rebuild(this);
    this.#setEditorDimensions();
  }

  /** @inheritdoc */
  shouldGetKeyboardEvents() {
    return this.isInEditMode();
  }

  /** @inheritdoc */
  enterInEditMode() {
    this.enableEditMode();
    this.editorDiv.focus();
  }

  /**
   * ondblclick callback.
   * @param {MouseEvent} event
   */
  dblclick(event) {
    this.enterInEditMode();
  }

  /**
   * onkeydown callback.
   * @param {KeyboardEvent} event
   */
  keydown(event) {
    console.log('keydown ', event)
    if (event.target === this.div && event.key === "Enter") {
      this.enterInEditMode();
      // Avoid to add an unwanted new line.
      event.preventDefault();
    }
  }

  editorDivKeydown(event) {
    TextEditor._keyboardManager.exec(this, event);
  }

  editorDivFocus(event) {
    this.isEditing = true;
  }

  editorDivBlur(event) {
    this.isEditing = false;
  }

  editorDivInput(event) {
    this.parent.div.classList.toggle("textEditing", this.isEmpty());
  }

  editorDivPaste(event) {
    this.isEditing = false;
  }

  /** @inheritdoc */
  disableEditing() {
    this.editorDiv.setAttribute("role", "comment");
    this.editorDiv.removeAttribute("aria-multiline");
  }

  /** @inheritdoc */
  enableEditing() {
    this.editorDiv.setAttribute("role", "textbox");
    this.editorDiv.setAttribute("aria-multiline", true);
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    super.render();
    this.editorDiv = document.createElement("div");
    this.editorDiv.className = "sign-box";

    this.editorDiv.setAttribute("id", this.#editorDivId);
    this.editorDiv.setAttribute("data-l10n-id", "pdfjs-free-text2");
    this.editorDiv.setAttribute("data-l10n-attrs", "default-content");
    if(!this.fieldName) {
      this.fieldName = uuid().replaceAll("-", "_");
    }

    this.editorDiv.setAttribute("data-text-annotation-id", this.fieldName);
    this.editorDiv.setAttribute(
      "aria-pressed", "false"
    );
    this.editorDiv.setAttribute("role", "button");
    this.editorDiv.setAttribute("aria-label", "sign button");
    // this.editorDiv.style.backgroundColor = "yellow";
    this.editorDiv.style.borderRadius = "15px";

    const signBoxImg = document.createElement("div");
    signBoxImg.setAttribute("class", "sign-box-img");
    const signImage = document.createElement("img");
    signImage.src = "assets/pencil.svg";
    signImage.setAttribute("aria-hidden", "true");
    signImage.setAttribute("focusable", "false");
    signImage.setAttribute("class", "sign-img");
    const signerDetail = document.createElement("div");
    signerDetail.setAttribute("class", "signer-detail");
    const signer = document.createElement("p");
    signer.setAttribute("class", "signer");
    signer.setAttribute("aria-hidden", "true");
    // signer.textContent = this.fieldName;
    const hint = document.createElement("p");
    hint.setAttribute("class", "hint");
    signerDetail.append(signer, hint);
    signBoxImg.append(signImage);
    this.editorDiv.append(signBoxImg, signerDetail);

    this.enableEditing();

    this.div.append(this.editorDiv);

    this.overlayDiv = document.createElement("div");
    this.overlayDiv.classList.add("overlay", "enabled");
    this.div.append(this.overlayDiv);

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);

    bindEvents(this, this.div, ["dblclick", "keydown"]);

    this._isDraggable = false;

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("TESTING")) {
      this.div.setAttribute("annotation-id", this.annotationElementId);
    }

    return this.div;
  }


  #serializeContent() {
    return this.fieldName.replaceAll("\xa0", " ");
  }

  /** @inheritdoc */
  get contentDiv() {
    return this.editorDiv;
  }

  /** @inheritdoc */
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof CustomTextWidgetAnnotationElement) {
      const {
        data: {
          defaultAppearanceData: { fontSize, fontColor },
          rect,
          rotation,
          id,
          popupRef
        },
        textContent,
        textPosition,
        parent: {
          page: { pageNumber },
        },
      } = data;

      initialData = data = {
        annotationType: AnnotationEditorType.TEXT,
        color: Array.from(fontColor),
        fontSize,
        value: textContent?.join("\n"),
        position: textPosition,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef,
        fieldName: data.data.fieldName
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    editor.#fontSize = data.fontSize;
    editor.#color = Util.makeHexColor(...data.color);
    editor.annotationElementId = data.id || null;
    editor._initialData = initialData;
    editor.fieldName = data.fieldName;
    return editor;
  }

  /** @inheritdoc */
  serialize(isForCopying = false) {
    if (this.isEmpty()) {
      return null;
    }

    if (this.deleted) {
      return this.serializeDeleted();
    }

    const padding = TextEditor._internalPadding * this.parentScale;
    const rect = this.getRect(padding, padding);
    const color = AnnotationEditor._colorManager.convert(
      this.isAttachedToDOM
        ? getComputedStyle(this.editorDiv).color
        : this.#color
    );

    const serialized = {
      annotationType: AnnotationEditorType.TEXT,
      color,
      fontSize: this.#fontSize,
      value: this.#serializeContent(),
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId,
    };

    if (isForCopying) {
      // Don't add the id when copying because the pasted editor mustn't be
      // linked to an existing annotation.
      return serialized;
    }

    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }

    serialized.id = this.annotationElementId;

    return serialized;
  }

  #hasElementChanged(serialized) {
    const { value, fontSize, color, pageIndex } = this._initialData;

    return (
      this._hasBeenMoved ||
      serialized.value !== value ||
      serialized.fontSize !== fontSize ||
      serialized.color.some((c, i) => c !== color[i]) ||
      serialized.pageIndex !== pageIndex
    );
  }

  /** @inheritdoc */
  renderAnnotationElement(annotation) {
    const content = super.renderAnnotationElement(annotation);
    if (this.deleted) {
      return content;
    }
    const { style } = content;
    style.fontSize = `calc(${this.#fontSize}px * var(--scale-factor))`;
    style.color = this.#color;

    content.replaceChildren();
    for (const line of this.fieldName.split("\n")) {
      const div = document.createElement("div");
      div.append(
        line ? document.createTextNode(line) : document.createElement("br")
      );
      content.append(div);
    }

    const padding = TextEditor._internalPadding * this.parentScale;
    annotation.updateEdited({
      rect: this.getRect(padding, padding),
      popupContent: this.fieldName,
    });

    return content;
  }

  resetAnnotationElement(annotation) {
    super.resetAnnotationElement(annotation);
    annotation.resetEdited();
  }

  /**
   * @returns {boolean} true if this editor can be resized.
   */
  get isResizable() {
    return true;
  }

  /** @inheritdoc */
  select() {
    super.select();
    this._isDraggable = true;
  }

  /** @inheritdoc */
  _onStopDragging() {
    this.commitOrRemove();
    this._uiManager.notifyAnnotationEditorChanged(this);
  }

  /** @inheritdoc */
  _onResized() {
    this.commitOrRemove();
    this._uiManager.notifyAnnotationEditorChanged(this);
  }

  /** @inheritdoc */
  async addEditToolbar() {
    const toolbar = await super.addEditToolbar();
    if (!toolbar) {
      return null;
    }
    toolbar.addOptionButton();
    return toolbar;
  }


}

export { TextEditor };
