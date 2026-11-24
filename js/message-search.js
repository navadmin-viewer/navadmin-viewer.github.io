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
   * @param {string} body The original message text.
   * @returns {string|null} The normalized body, if there is text to search.
   */
  function normalizeBody(body) {
    return typeof body === 'string' ? body.replace(/\s+/g, ' ').trim() || null : null;
  }

  function snippetForMatch(body, match) {
    var matchEnd = match.index + match[0].length;
    var start = Math.max(0, match.index - contextBefore);
    var end = Math.min(body.length, matchEnd + contextAfter);
    return {
      before: (start ? '\u2026' : '') + body.substring(start, match.index),
      match: match[0],
      after: body.substring(matchEnd, end) + (end < body.length ? '\u2026' : '')
    };
  }

  function cachedBodySnippet(body, matcher) {
    if (!body.normalized) {
      body.text = normalizeBody(body.text);
      body.normalized = true;
    }
    if (body.matcher !== matcher) {
      var match = body.text && matcher.exec(body.text);
      body.snippet = match ? snippetForMatch(body.text, match) : null;
      body.matcher = matcher;
    }
    return body.snippet;
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

  function matcher(query) {
    var search = fullMessage ? normalizeBody(query) : query;
    return search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  }

  Navadmin.messageSearch = {
    init: init,
    isFullMessage: isFullMessage,
    matcher: matcher,
    cachedBodySnippet: cachedBodySnippet,
    appendSnippet: appendSnippet
  };
})(window, window.jQuery);
