(function(window, document) {
  var messageSearch = window.Navadmin.messageSearch;
  var wordPattern = '[\\p{L}\\p{N}\\p{M}]+';
  var alphabeticWord;

  // The vendored MiniSearch build uses Unicode property escapes, which IE11 cannot parse.
  if (document.documentMode) return;
  try {
    alphabeticWord = new RegExp('^\\p{L}[\\p{L}\\p{M}]*$', 'u');
    if (!alphabeticWord.test('A')) return;
  } catch (error) {
    return;
  }

  function tokenize(text) {
    return text.match(new RegExp(wordPattern, 'gu')) || [];
  }

  function maxTypoEdits(term) {
    // Bound the size of MiniSearch's edit-distance matrix for pasted input.
    if (term.length < 5 || term.length > 128 || !alphabeticWord.test(term)) return false;
    return term.length < 9 ? 1 : 2;
  }

  // Return the location and original spelling of a matched term for the existing snippet renderer.
  function findMatch(messageBodyText) {
    var words = new RegExp(wordPattern, 'gu');
    var firstMatch;
    var match;
    while ((match = words.exec(messageBodyText))) {
      var term = match[0].toLowerCase();
      if (this.terms.indexOf(term) === -1) continue;
      if (this.queryTerms.indexOf(term) === -1) return match;
      if (!firstMatch) firstMatch = match;
    }
    return firstMatch;
  }

  function createFuzzySearch() {
    var index = new window.MiniSearch({ fields: ['text'], tokenize: tokenize });
    var indexedMessageBodies = new Set();

    function addMessageBodies(messageBodies, isCurrent, done) {
      var position = 0;
      function indexBatch() {
        if (!isCurrent()) return;
        var deadline = Date.now() + 8;
        while (position < messageBodies.length && Date.now() < deadline) {
          var messageBody = messageBodies[position++];
          if (typeof messageBody.text === 'string' && !indexedMessageBodies.has(messageBody)) {
            index.add({ id: messageBody, text: messageBody.text });
            indexedMessageBodies.add(messageBody);
          }
        }
        if (position < messageBodies.length) {
          window.setTimeout(indexBatch, 0);
          return;
        }
        done();
      }
      indexBatch();
    }

    function search(query, messageBodies, isCurrent, done) {
      var queryTerms = tokenize(query).map(function(term) { return term.toLowerCase(); });
      if (!queryTerms.some(maxTypoEdits)) {
        done();
        return;
      }

      // Use each cached message body as its index ID so replacements get new IDs.
      var currentMessageBodies = new Set(messageBodies);
      indexedMessageBodies.forEach(function(messageBody) {
        if (!currentMessageBodies.has(messageBody)) {
          index.discard(messageBody);
          indexedMessageBodies.delete(messageBody);
        }
      });

      addMessageBodies(messageBodies, isCurrent, function() {
        var matches = new Map();
        index.search(query, { fuzzy: maxTypoEdits, combineWith: 'AND' }).forEach(function(result) {
          matches.set(result.id, {
            score: result.score,
            terms: result.terms,
            queryTerms: queryTerms,
            findMatch: findMatch
          });
        });
        done(matches);
      });
    }

    return { addMessageBodies: addMessageBodies, search: search };
  }

  function register() {
    if (typeof window.MiniSearch !== 'function') return;
    messageSearch.createFuzzySearch = createFuzzySearch;
    var input = document.getElementById('msg-search-input');
    if (input && (input.value.trim() || document.activeElement === input) && messageSearch.isFullMessage()) {
      // Let the existing input handler use the provider for the query or focused field.
      input.dispatchEvent(new window.Event('input'));
    }
  }

  // Load the local browser bundle before search is needed so it can also be cached offline.
  if (typeof window.MiniSearch === 'function') {
    register();
  } else {
    var script = document.createElement('script');
    script.src = new URL('external/minisearch-7.2.0.min.js', document.currentScript.src).href;
    script.onload = register;
    document.head.appendChild(script);
  }
})(window, document);
