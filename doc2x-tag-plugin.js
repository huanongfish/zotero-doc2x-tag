Doc2XTagPlugin = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  notifierID: null,
  windowStates: new WeakMap(),

  config: {
    // ── doc2x auto-tag ──────────────────────────────────────────────────────
    doc2xTag: "Ⓜ️",
    notePrefixes: ["原文MD_doc2x", "原文md_doc2x", "parse_"],

    // ── manuscript importance tags ──────────────────────────────────────────
    manuscripts: {
      "NS": "Nature Sustainability",
    },
    levels: [
      { num: "①", desc: "核心论据 — 必引" },
      { num: "②", desc: "重要参考 — 很可能引" },
      { num: "③", desc: "有用背景 — 可能引" },
      { num: "④", desc: "低优先级 — 暂时用不上" },
      { num: "⑤", desc: "存档备查 — 基本不引" },
    ],

    // ── tag color scheme ────────────────────────────────────────────────────
    // Colors auto-assigned on startup (only if tag not already colored).
    // Position determines left-to-right order in the item list.
    // Level colors use the circled-number as the visible glyph (Zotero 9
    // renders the first non-ASCII character of the tag name as the badge).
    tagColors: [
      // importance levels: position 1–5, circled-number first so Zotero renders it as badge glyph
      { tag: "①NS", color: "#e52207", position: 1 },
      { tag: "②NS", color: "#f57800", position: 2 },
      { tag: "③NS", color: "#e8c100", position: 3 },
      { tag: "④NS", color: "#7d9db5", position: 4 },
      { tag: "⑤NS", color: "#aaaaaa", position: 5 },
      // doc2x MD tag: position 6
      { tag: "Ⓜ️",   color: "#2369bd", position: 6 },
    ],
  },

  // ── helpers ────────────────────────────────────────────────────────────────

  log(msg) {
    Zotero.debug(`Doc2X Tag: ${msg}`);
  },

  importanceTags(prefix) {
    return this.config.levels.map((l) => `${l.num}${prefix}`);
  },

  makeTag(prefix, num) {
    return `${num}${prefix}`;
  },

  // ── init / notifier ────────────────────────────────────────────────────────

  init({ id, version, rootURI }) {
    if (this.initialized) return;
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.initialized = true;

    const plugin = this;
    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: async function (event, type, ids) {
          if (type !== "item") return;
          if (event !== "add" && event !== "modify") return;
          for (const id of ids) {
            try {
              const item = Zotero.Items.get(id);
              if (!item || item.itemType !== "note") continue;
              await plugin.maybeTagParent(item);
            } catch (e) {
              plugin.log(`notify error on item ${id}: ${e}`);
            }
          }
        },
      },
      ["item"],
      "doc2x-tag"
    );
    this.log(`notifier registered (id=${this.notifierID})`);
  },

  isDoc2xNote(title) {
    if (!title) return false;
    return this.config.notePrefixes.some((p) => title.startsWith(p));
  },

  async maybeTagParent(item) {
    if (!item || item.itemType !== "note") return;
    const title = item.getField("title") || "";
    if (!this.isDoc2xNote(title)) return;
    const parent = item.parentItem;
    if (!parent) return;
    if (parent.getTags().some((t) => t.tag === this.config.doc2xTag)) return;
    parent.addTag(this.config.doc2xTag);
    await parent.saveTx();
    this.log(`Ⓜ️ tagged: ${parent.getField("title")}`);
  },

  // ── importance tag assignment ──────────────────────────────────────────────

  async setImportanceTag(window, prefix, levelNum) {
    const items = window.ZoteroPane.getSelectedItems().filter(
      (it) => !it.isNote() && !it.isAttachment()
    );
    if (!items.length) return;
    const allTags = this.importanceTags(prefix);
    const newTag = `${levelNum}${prefix}`;
    for (const item of items) {
      for (const t of allTags) item.removeTag(t);
      item.addTag(newTag);
      await item.saveTx();
    }
    this.log(`set ${newTag} on ${items.length} item(s)`);
  },

  async removeImportanceTag(window, prefix) {
    const items = window.ZoteroPane.getSelectedItems().filter(
      (it) => !it.isNote() && !it.isAttachment()
    );
    if (!items.length) return;
    const allTags = this.importanceTags(prefix);
    for (const item of items) {
      for (const t of allTags) item.removeTag(t);
      await item.saveTx();
    }
    this.log(`removed ${prefix} importance tag from ${items.length} item(s)`);
  },

  // ── window management ──────────────────────────────────────────────────────

  // ── tag color auto-assignment ──────────────────────────────────────────────

  async ensureTagColors() {
    const libID = Zotero.Libraries.userLibrary.id;
    // getColors returns a Map: tagName → { color, position }
    const existing = Zotero.Tags.getColors(libID);
    for (const { tag, color, position } of this.config.tagColors) {
      if (existing.has(tag)) continue; // respect manual overrides
      try {
        await Zotero.Tags.setColor(libID, tag, color, position);
        this.log(`color set: ${tag} → ${color} @${position}`);
      } catch (e) {
        this.log(`setColor failed for ${tag}: ${e}`);
      }
    }
  },

  addToAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      if (!window.ZoteroPane) continue;
      this.addToWindow(window);
    }
    // Run after windows are ready so Zotero.Tags API is fully available
    this.ensureTagColors().catch((e) => this.log(`ensureTagColors error: ${e}`));
  },

  removeFromAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      if (!window.ZoteroPane) continue;
      this.removeFromWindow(window);
    }
  },

  addToWindow(window) {
    if (this.windowStates.has(window)) return;
    const doc = window.document;
    const els = [];

    // ── Tools menu items ───────────────────────────────────────────────────
    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (toolsPopup) {
      const mi1 = doc.createXULElement("menuitem");
      mi1.id = "doc2x-tag-scan-menuitem";
      mi1.setAttribute("label", `Doc2X: scan & tag ${this.config.doc2xTag}`);
      mi1.addEventListener("command", () =>
        this.scanAndTag(window).catch((e) => this.log(`scan error: ${e}`))
      );
      toolsPopup.appendChild(mi1);
      els.push(mi1);

      const mi2 = doc.createXULElement("menuitem");
      mi2.id = "doc2x-tag-scan-all-menuitem";
      mi2.setAttribute("label", `Doc2X: scan ALL library ${this.config.doc2xTag}`);
      mi2.addEventListener("command", () =>
        this.scanAllLibrary(window).catch((e) => this.log(`scan-all error: ${e}`))
      );
      toolsPopup.appendChild(mi2);
      els.push(mi2);
    }

    // ── Right-click context menu ───────────────────────────────────────────
    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) {
      const sep = doc.createXULElement("menuseparator");
      sep.id = "doc2x-importance-sep";
      itemMenu.appendChild(sep);
      els.push(sep);

      // Top-level "Importance tag" menu
      const topMenu = doc.createXULElement("menu");
      topMenu.id = "doc2x-importance-menu";
      topMenu.setAttribute("label", "Importance tag");
      const topPopup = doc.createXULElement("menupopup");

      for (const [prefix, label] of Object.entries(this.config.manuscripts)) {
        const msMenu = doc.createXULElement("menu");
        msMenu.setAttribute("label", `${prefix}  (${label})`);
        const msPopup = doc.createXULElement("menupopup");

        // Level items
        for (const { num, desc } of this.config.levels) {
          const lvlItem = doc.createXULElement("menuitem");
          lvlItem.setAttribute("label", `${num}  ${desc}`);
          lvlItem.addEventListener("command", () =>
            this.setImportanceTag(window, prefix, num).catch((e) =>
              this.log(`set tag error: ${e}`)
            )
          );
          msPopup.appendChild(lvlItem);
        }

        // Remove option
        msPopup.appendChild(doc.createXULElement("menuseparator"));
        const removeItem = doc.createXULElement("menuitem");
        removeItem.setAttribute("label", "Remove importance tag");
        removeItem.addEventListener("command", () =>
          this.removeImportanceTag(window, prefix).catch((e) =>
            this.log(`remove tag error: ${e}`)
          )
        );
        msPopup.appendChild(removeItem);

        msMenu.appendChild(msPopup);
        topPopup.appendChild(msMenu);
      }

      topMenu.appendChild(topPopup);
      itemMenu.appendChild(topMenu);
      els.push(topMenu);
    }

    this.windowStates.set(window, { els });
    this.log("window UI attached");
  },

  removeFromWindow(window) {
    const state = this.windowStates.get(window);
    if (state) {
      for (const el of state.els) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
    }
    this.windowStates.delete(window);
  },

  // ── scan helpers ───────────────────────────────────────────────────────────

  async scanAndTag(window) {
    const ZP = window.ZoteroPane;
    let items = [];
    let scope = "";
    const collection = ZP.getSelectedCollection();
    if (collection) {
      const ids = collection.getChildItems(false, false);
      items = ids.map((it) => (typeof it === "object" ? it : Zotero.Items.get(it)));
      scope = `collection "${collection.name}"`;
    } else {
      items = ZP.getSelectedItems();
      scope = `${items.length} selected item(s)`;
    }
    const { tagged, alreadyTagged, scanned } = await this._doScan(items);
    const msg = `Scope: ${scope}\nScanned: ${scanned}\nNewly tagged: ${tagged}\nAlready tagged: ${alreadyTagged}`;
    this.log(msg.replace(/\n/g, " | "));
    Services.prompt.alert(window, "Doc2X Tag", msg);
  },

  async scanAllLibrary(window) {
    const lib = Zotero.Libraries.userLibrary;
    const allItems = await Zotero.Items.getAll(lib.id, false, false, true);
    const { tagged, alreadyTagged, scanned } = await this._doScan(allItems);
    const msg = `Scope: full library\nScanned: ${scanned}\nNewly tagged: ${tagged}\nAlready tagged: ${alreadyTagged}`;
    this.log(msg.replace(/\n/g, " | "));
    Services.prompt.alert(window, "Doc2X Tag", msg);
  },

  async _doScan(items) {
    let tagged = 0, alreadyTagged = 0, scanned = 0;
    for (const item of items) {
      if (!item || item.isNote() || item.isAttachment()) continue;
      scanned++;
      const noteIDs = item.getNotes() || [];
      let hasDoc2x = false;
      for (const nid of noteIDs) {
        const note = Zotero.Items.get(nid);
        if (note && this.isDoc2xNote(note.getField("title") || "")) {
          hasDoc2x = true;
          break;
        }
      }
      if (!hasDoc2x) continue;
      if (item.getTags().some((t) => t.tag === this.config.doc2xTag)) {
        alreadyTagged++;
        continue;
      }
      item.addTag(this.config.doc2xTag);
      await item.saveTx();
      tagged++;
    }
    return { tagged, alreadyTagged, scanned };
  },

  // ── shutdown ───────────────────────────────────────────────────────────────

  shutdown() {
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
    this.removeFromAllWindows();
    this.initialized = false;
  },
};
