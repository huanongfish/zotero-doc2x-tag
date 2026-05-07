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
    // Ⓐ️–Ⓔ️ = Enclosed Latin Capital Letters + VS-16, same block as Ⓜ️ (U+24C2).
    // Renders at identical size to Ⓜ️. A=核心 … E=存档, like academic grades.
    levels: [
      { num: "Ⓐ️", desc: "核心论据 — 必引" },
      { num: "Ⓑ️", desc: "重要参考 — 很可能引" },
      { num: "Ⓒ️", desc: "有用背景 — 可能引" },
      { num: "Ⓓ️", desc: "低优先级 — 暂时用不上" },
      { num: "Ⓔ️", desc: "存档备查 — 基本不引" },
    ],

    // ── tag color scheme ────────────────────────────────────────────────────
    tagColors: [
      { tag: "Ⓐ️NS", color: "#e52207", position: 1 },
      { tag: "Ⓑ️NS", color: "#f57800", position: 2 },
      { tag: "Ⓒ️NS", color: "#e8c100", position: 3 },
      { tag: "Ⓓ️NS", color: "#7d9db5", position: 4 },
      { tag: "Ⓔ️NS", color: "#aaaaaa", position: 5 },
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
    // ALWAYS overwrite (no skip-if-existing). Stale color/position state from
    // earlier plugin versions otherwise persists and breaks badge rendering.
    for (const { tag, color, position } of this.config.tagColors) {
      try {
        await Zotero.Tags.setColor(libID, tag, color, position);
        this.log(`color set: ${tag} → ${color} @${position}`);
      } catch (e) {
        this.log(`setColor failed for ${tag}: ${e}`);
      }
    }
  },

  // Removes color entries AND purges old-format tags from the library entirely.
  // Returns { removedColors, purgedTags, missingFromLibrary }.
  async cleanupHistoricalTags() {
    const libID = Zotero.Libraries.userLibrary.id;
    const historical = this._collectHistoricalTagNames();
    let removedColors = 0, purgedTags = 0;
    const colors = Zotero.Tags.getColors(libID);
    for (const tag of historical) {
      if (colors.has(tag)) {
        try {
          await Zotero.Tags.setColor(libID, tag, false);
          removedColors++;
        } catch (e) { this.log(`remove color failed for ${tag}: ${e}`); }
      }
    }
    for (const tag of historical) {
      const tagID = Zotero.Tags.getID(libID, tag);
      if (tagID !== false) {
        try {
          await Zotero.Tags.removeFromLibrary(libID, [tagID]);
          purgedTags++;
        } catch (e) { this.log(`purge failed for ${tag}: ${e}`); }
      }
    }
    await this.ensureTagColors();
    return { removedColors, purgedTags };
  },

  // Returns full list of historical importance tag names from every past plugin version.
  _collectHistoricalTagNames() {
    const out = [];
    const oldNums = ["①","②","③","④","⑤"];
    const oldBold = ["❶","❷","❸","❹","❺"];
    for (const prefix of Object.keys(this.config.manuscripts)) {
      for (const n of oldNums) {
        out.push(`${prefix}:${n}`);    // v0.x: NS:①
        out.push(`${n}${prefix}`);     // v0.7: ①NS
        out.push(`${n}️${prefix}`);  // v0.8/0.9: ①️NS (with VS-16)
      }
      for (const n of oldBold) {
        out.push(`${n}${prefix}`);     // v0.10: ❶NS
      }
    }
    return out;
  },

  addToAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      if (!window.ZoteroPane) continue;
      this.addToWindow(window);
    }
    // Auto-migrate old tag formats then apply colors; fast path skips if nothing to do.
    this._autoMigrate().catch((e) => this.log(`autoMigrate error: ${e}`));
  },

  async _autoMigrate() {
    const libID = Zotero.Libraries.userLibrary.id;
    const renameMap = this._buildImportanceRenameMap();
    // Fast check: does any old-format tag exist? (in-memory lookup, no DB query)
    const needsMigration = [...renameMap.keys()].some(
      (old) => Zotero.Tags.getID(libID, old) !== false
    );
    if (needsMigration) {
      this.log("old importance tags detected — auto-migrating…");
      const allItems = await Zotero.Items.getAll(libID, false, false, true);
      const n = await this.migrateImportanceTags(allItems);
      this.log(`auto-migrated ${n} item(s)`);
    }
    await this.ensureTagColors();
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

      const mi3 = doc.createXULElement("menuitem");
      mi3.id = "doc2x-tag-migrate-menuitem";
      mi3.setAttribute("label", "Doc2X: migrate importance tags (collection/selected)");
      mi3.addEventListener("command", () =>
        this.migrateScoped(window).catch((e) => this.log(`migrate error: ${e}`))
      );
      toolsPopup.appendChild(mi3);
      els.push(mi3);

      const mi4 = doc.createXULElement("menuitem");
      mi4.id = "doc2x-tag-cleanup-menuitem";
      mi4.setAttribute("label", "Doc2X: cleanup historical tags + reset colors");
      mi4.addEventListener("command", () =>
        this.cleanupAndReport(window).catch((e) => this.log(`cleanup error: ${e}`))
      );
      toolsPopup.appendChild(mi4);
      els.push(mi4);

      const mi5 = doc.createXULElement("menuitem");
      mi5.id = "doc2x-tag-diag-menuitem";
      mi5.setAttribute("label", "Doc2X: show tag color diagnostics");
      mi5.addEventListener("command", () =>
        this.showDiagnostics(window).catch((e) => this.log(`diag error: ${e}`))
      );
      toolsPopup.appendChild(mi5);
      els.push(mi5);
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

  async cleanupAndReport(window) {
    const libID = Zotero.Libraries.userLibrary.id;
    // First migrate any remaining old-format item tags so we don't lose data
    const allItems = await Zotero.Items.getAll(libID, false, false, true);
    const migrated = await this.migrateImportanceTags(allItems);
    const { removedColors, purgedTags } = await this.cleanupHistoricalTags();
    const msg = `Cleanup complete:\n` +
      `Items migrated: ${migrated}\n` +
      `Old color entries removed: ${removedColors}\n` +
      `Old tags purged from library: ${purgedTags}\n` +
      `Current colors re-applied: ${this.config.tagColors.length}`;
    this.log(msg.replace(/\n/g, " | "));
    Services.prompt.alert(window, "Doc2X Tag", msg);
  },

  async showDiagnostics(window) {
    const libID = Zotero.Libraries.userLibrary.id;
    const colors = Zotero.Tags.getColors(libID);
    const lines = ["Current colored tags in library:", ""];
    // Sort by position
    const entries = [...colors.entries()].sort(
      (a, b) => (a[1].position || 99) - (b[1].position || 99)
    );
    for (const [tag, info] of entries) {
      const codes = [...tag].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
      lines.push(`pos ${info.position}  "${tag}"  ${info.color}  [${codes}]`);
    }
    lines.push("", "Configured colors (this plugin):");
    for (const { tag, color, position } of this.config.tagColors) {
      const codes = [...tag].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
      const matches = colors.has(tag) ? "✓ in library" : "✗ MISSING";
      lines.push(`pos ${position}  "${tag}"  ${color}  [${codes}]  ${matches}`);
    }
    Services.prompt.alert(window, "Doc2X Tag — Diagnostics", lines.join("\n"));
  },

  async migrateScoped(window) {
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
    const migrated = await this.migrateImportanceTags(items);
    await this.ensureTagColors();
    const msg = `Scope: ${scope}\nItems checked: ${items.length}\nImportance tags migrated: ${migrated}`;
    this.log(msg.replace(/\n/g, " | "));
    Services.prompt.alert(window, "Doc2X Tag", msg);
  },

  // Renames old-format importance tags (NS:① or ①NS) → current format (①️NS).
  // Returns count of items updated.
  async migrateImportanceTags(items) {
    const renameMap = this._buildImportanceRenameMap();
    let count = 0;
    for (const item of items) {
      if (!item || item.isNote() || item.isAttachment()) continue;
      const tags = item.getTags().map((t) => t.tag);
      const toRename = tags.filter((t) => renameMap.has(t));
      if (!toRename.length) continue;
      for (const old of toRename) {
        item.removeTag(old);
        item.addTag(renameMap.get(old));
      }
      await item.saveTx();
      count++;
    }
    return count;
  },

  // Builds a Map: every known old tag format → current Ⓐ️NS-style tag.
  _buildImportanceRenameMap() {
    const oldNums = ["①", "②", "③", "④", "⑤"];
    const oldBold = ["❶", "❷", "❸", "❹", "❺"];
    const newNums = ["Ⓐ️", "Ⓑ️", "Ⓒ️", "Ⓓ️", "Ⓔ️"];
    const map = new Map();
    for (const prefix of Object.keys(this.config.manuscripts)) {
      newNums.forEach((newNum, i) => {
        const newTag = `${newNum}${prefix}`;
        map.set(`${prefix}:${oldNums[i]}`,     newTag); // NS:①
        map.set(`${oldNums[i]}${prefix}`,      newTag); // ①NS
        map.set(`${oldNums[i]}️${prefix}`,   newTag); // ①️NS
        map.set(`${oldBold[i]}${prefix}`,      newTag); // ❶NS
      });
    }
    return map;
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
