const AppStorage = (() => {
  const KEYS = Object.freeze({
    inventory: "ieomok.mockup.inventory",
    cookedHistory: "ieomok.mockup.cooked",
    lastDeductions: "ieomok.mockup.deductions"
  });

  function read(key, fallback){
    const savedValue = localStorage.getItem(key);
    return savedValue === null ? fallback : JSON.parse(savedValue);
  }

  function loadState(defaultInventory){
    const inventoryFallback = JSON.parse(JSON.stringify(defaultInventory));

    return {
      inventory: read(KEYS.inventory, null) || inventoryFallback,
      cookedHistory: read(KEYS.cookedHistory, []),
      lastDeductions: read(KEYS.lastDeductions, [])
    };
  }

  function loadLegacyInventory(){
    const inventory = read(KEYS.inventory,null);
    return Array.isArray(inventory) ? inventory : null;
  }

  function removeLegacyInventory(){
    localStorage.removeItem(KEYS.inventory);
  }

  function saveState({cookedHistory, lastDeductions}){
    localStorage.setItem(KEYS.cookedHistory, JSON.stringify(cookedHistory));
    localStorage.setItem(KEYS.lastDeductions, JSON.stringify(lastDeductions));
  }

  return {loadState,loadLegacyInventory,removeLegacyInventory,saveState};
})();
