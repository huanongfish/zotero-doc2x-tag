var Doc2XTagPlugin;

function log(msg) {
  Zotero.debug("Doc2X Tag: " + msg);
}

function install() {
  log("Installed");
}

async function startup({ id, version, rootURI }) {
  log(`Starting ${version}`);
  Services.scriptloader.loadSubScript(rootURI + "doc2x-tag-plugin.js");
  Doc2XTagPlugin.init({ id, version, rootURI });
  Doc2XTagPlugin.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  Doc2XTagPlugin.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  Doc2XTagPlugin.removeFromWindow(window);
}

function shutdown() {
  log("Shutting down");
  if (Doc2XTagPlugin) {
    Doc2XTagPlugin.removeFromAllWindows();
    Doc2XTagPlugin = undefined;
  }
}

function uninstall() {
  log("Uninstalled");
}
