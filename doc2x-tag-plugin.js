Doc2XTagPlugin = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  notifierID: null,
  windowStates: new WeakMap(),

  config: {
    tag: "Ⓜ️",
    notePrefixes: ["原文MD_doc2x", "原文md_doc2x", "parse_"],
  },

  init({ id, version, rootURI }) {
    if (this.initialized) {
      return;
    }
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
              // Doc2X often writes the title after the note row is created,
              // so the title may not be set on `add`. Retry on `modify` too.
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

  log(message) {
    Zotero.debug(`Doc2X Tag: ${message}`);
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

    if (parent.getTags().some((t) => t.tag === this.config.tag)) return;

    parent.addTag(this.config.tag);
    await parent.saveTx();
    this.log(`tagged: ${parent.getField("title")}`);
  },

  addToAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      if (!window.ZoteroPane) continue;
      this.addToWindow(window);
    }
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
    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (!toolsPopup) {
      this.windowStates.set(window, {});
      return;
    }
    const menuItem = doc.createXULElement("menuitem");
    menuItem.id = "doc2x-tag-scan-menuitem";
    menuItem.setAttribute("label", `Doc2X: scan & tag ${this.config.tag}`);
    menuItem.addEventListener("command", () => {
      this.scanAndTag(window).catch((e) => this.log(`scan error: ${e}`));
    });
    toolsPopup.appendChild(menuItem);

    const menuItemAll = doc.createXULElement("menuitem");
    menuItemAll.id = "doc2x-tag-scan-all-menuitem";
    menuItemAll.setAttribute("label", `Doc2X: scan ALL library ${this.config.tag}`);
    menuItemAll.addEventListener("command", () => {
      this.scanAllLibrary(window).catch((e) => this.log(`scan-all error: ${e}`));
    });
    toolsPopup.appendChild(menuItemAll);

    this.windowStates.set(window, { menuItem, menuItemAll });
    this.log("tools menu items added");
  },

  removeFromWindow(window) {
    const state = this.windowStates.get(window);
    if (state) {
      for (const key of ["menuItem", "menuItemAll"]) {
        const el = state[key];
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
    }
    this.windowStates.delete(window);
  },

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

    let tagged = 0;
    let alreadyTagged = 0;
    let scanned = 0;
    for (const item of items) {
      if (!item || item.isNote() || item.isAttachment()) continue;
      scanned++;
      const noteIDs = item.getNotes() || [];
      let hasDoc2x = false;
      for (const nid of noteIDs) {
        const note = Zotero.Items.get(nid);
        if (!note) continue;
        const title = note.getField("title") || "";
        if (this.isDoc2xNote(title)) {
          hasDoc2x = true;
          break;
        }
      }
      if (!hasDoc2x) continue;
      if (item.getTags().some((t) => t.tag === this.config.tag)) {
        alreadyTagged++;
        continue;
      }
      item.addTag(this.config.tag);
      await item.saveTx();
      tagged++;
    }

    const msg =
      `Scope: ${scope}\n` +
      `Scanned: ${scanned}\n` +
      `Newly tagged: ${tagged}\n` +
      `Already tagged: ${alreadyTagged}`;
    this.log(msg.replace(/\n/g, " | "));
    Services.prompt.alert(window, "Doc2X Tag", msg);
  },

  async scanAllLibrary(window) {
    const lib = Zotero.Libraries.userLibrary;
    const allItems = await Zotero.Items.getAll(lib.id, false, false, true);

    let tagged = 0;
    let alreadyTagged = 0;
    let scanned = 0;
    for (const item of allItems) {
      if (!item || item.isNote() || item.isAttachment()) continue;
      scanned++;
      const noteIDs = item.getNotes() || [];
      let hasDoc2x = false;
      for (const nid of noteIDs) {
        const note = Zotero.Items.get(nid);
        if (!note) continue;
        if (this.isDoc2xNote(note.getField("title") || "")) {
          hasDoc2x = true;
          break;
        }
      }
      if (!hasDoc2x) continue;
      if (item.getTags().some((t) => t.tag === this.config.tag)) {
        alreadyTagged++;
        continue;
      }
      item.addTag(this.config.tag);
      await item.saveTx();
      tagged++;
    }

    const msg =
      `Scope: full library\n` +
      `Scanned: ${scanned}\n` +
      `Newly tagged: ${tagged}\n` +
      `Already tagged: ${alreadyTagged}`;
    this.log(msg.replace(/\n/g, " | "));
    Services.prompt.alert(window, "Doc2X Tag", msg);
  },

  shutdown() {
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
    this.removeFromAllWindows();
    this.initialized = false;
  },
};
