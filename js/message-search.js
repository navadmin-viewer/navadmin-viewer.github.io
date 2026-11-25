(function(window, $) {
  var Navadmin = window.Navadmin || (window.Navadmin = {});
  var fullMessage = true;
  var contextBefore = 45;
  var contextAfter = 70;

  function init(onScopeChanged) {
    var dropdown = $('#msg-search-scope-dropdown');
    var dropdownLabel = dropdown.find('.message-search-scope-label');
    var menu = $('#msg-search-scope-menu');
    menu.on('click', '.dropdown-item', function() {
      dropdown[0].focus();
      var nextFullMessage = this.value === 'full-message';
      if (fullMessage === nextFullMessage) {
        return;
      }

      fullMessage = nextFullMessage;
      var label = this.textContent;
      dropdownLabel.text(label);
      dropdown.attr('aria-label', 'Search scope: ' + label);
      menu.find('.dropdown-item').removeClass('active').attr('aria-checked', 'false');
      $(this).addClass('active').attr('aria-checked', 'true');
      onScopeChanged(fullMessage);
    });
  }

  function isFullMessage() {
    return fullMessage;
  }

  /**
   * Collapse line breaks and repeated whitespace for matching and showing excerpts.
   * @param {string} text The message body or search query.
   * @returns {string|null} The normalized text, if there is text to search.
   */
  function normalizeSearchText(text) {
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() || null : null;
  }

  function snippetForMatch(messageBodyText, match) {
    var matchEnd = match.index + match[0].length;
    var start = Math.max(0, match.index - contextBefore);
    var end = Math.min(messageBodyText.length, matchEnd + contextAfter);
    return {
      before: (start ? '\u2026' : '') + messageBodyText.substring(start, match.index),
      match: match[0],
      after: messageBodyText.substring(matchEnd, end) + (end < messageBodyText.length ? '\u2026' : '')
    };
  }

  function matchMessageBody(messageBody, matcher, fuzzyMatches) {
    if (!messageBody.normalized) {
      messageBody.text = normalizeSearchText(messageBody.text);
      messageBody.normalized = true;
    }
    if (messageBody.matcher !== matcher) {
      var literalMatch = messageBody.text && matcher.exec(messageBody.text);
      messageBody.snippet = literalMatch ? snippetForMatch(messageBody.text, literalMatch) : null;
      messageBody.matcher = matcher;
    }
    if (messageBody.snippet) return { snippet: messageBody.snippet, fuzzyScore: 0 };

    var fuzzy = fuzzyMatches && fuzzyMatches.get(messageBody);
    var fuzzyMatch = fuzzy && messageBody.text && fuzzy.findMatch(messageBody.text);
    return fuzzyMatch ? { snippet: snippetForMatch(messageBody.text, fuzzyMatch), fuzzyScore: fuzzy.score } : null;
  }

  function appendSnippet(cell, text) {
    var document = cell.ownerDocument;
    var snippet = document.createElement('div');
    var mark = document.createElement('mark');
    snippet.className = 'message-search-snippet';
    snippet.appendChild(document.createTextNode(text.before));
    mark.textContent = text.match;
    snippet.appendChild(mark);
    snippet.appendChild(document.createTextNode(text.after));
    cell.appendChild(snippet);
  }

  function createLiteralMatcher(query) {
    var search = fullMessage ? normalizeSearchText(query) : query;
    return search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  }

  Navadmin.messageSearch = {
    init: init,
    isFullMessage: isFullMessage,
    createLiteralMatcher: createLiteralMatcher,
    matchMessageBody: matchMessageBody,
    appendSnippet: appendSnippet
  };
})(window, window.jQuery);
