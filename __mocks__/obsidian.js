'use strict';

/** Minimal Obsidian API stub for Jest. */
function noop() {}
function stub() {
  return {
    setPlaceholder: noop,
    setValue: noop,
    onChange: noop,
    setAttribute: noop,
    addButton: noop,
    addText: noop,
    addDropdown: noop,
    addTextArea: noop,
  };
}

module.exports = {
  App: function App() {},
  Notice: function Notice() {},
  PluginSettingTab: class PluginSettingTab {
    constructor() {}
    display() {}
  },
  requestUrl: noop,
  Setting: class Setting {
    constructor() {
      return Object.assign(this, {
        setSettingEl: noop,
        setName: () => this,
        setDesc: () => this,
        addText: () => stub(),
        addButton: () => ({ setButtonText: noop, onClick: noop, setDisabled: noop }),
        addDropdown: () => stub(),
        addTextArea: () => stub(),
        settingEl: { style: {}, replaceChildren: noop },
      });
    }
  },
};
