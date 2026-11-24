/**
 * Encode a map as a marker followed by its ordered key-value pairs.
 * @returns {Array} The map representation used in the offline cache.
 * @see https://stackoverflow.com/a/51221692/761902
 */
Map.prototype.toJSON = function() {
  var entries = [];
  this.forEach(function(value, key) {
    entries.push([key, value]);
  });
  return ['window.Map', entries];
};

/**
 * Serialize a map and any nested maps for browser storage.
 * @param {Map} map The map to save.
 * @returns {string} The map as JSON.
 */
function serializeMap(map) {
  return JSON.stringify(map);
}

/**
 * Restore maps from their saved key-value pairs.
 * @param {string|null} serialized The JSON from browser storage.
 * @returns {*} The decoded JSON value with maps restored, or null if the data is absent or unreadable.
 */
function deserializeMapString(serialized) {
  if (!serialized) {
    return null;
  }

  function restoreMap(value) {
    if (value[0] != 'window.Map') {
      return value;
    }

    var map = new Map();
    value[1].forEach(function(entry) {
      var entryValue = entry[1];
      map.set(entry[0], Array.isArray(entryValue) ? restoreMap(entryValue) : entryValue);
    });
    return map;
  }

  try {
    return restoreMap(JSON.parse(serialized));
  } catch (error) {
    console.log('Unable to restore the message cache from browser storage.', error.name);
    return null;
  }
}
