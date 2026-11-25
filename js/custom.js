var availableMsgTypes = [
  MsgType.NAVADMIN,
  MsgType.ALNAV,
  MsgType.MARADMIN,
  MsgType.ALMAR
];

// Callbacks compare their selection object with the current one before changing the UI.
var listSelection;
var crossYearSearchState;
var activeSearch;
var searchInput;
var searchSpinner;
var displayedSearchRows;
var pendingYearStatus = new Map();
var yearStatusTimer;
var filterLayoutTimer;
// Keep the values actually rendered alongside each row. Null represents an unavailable list.
// Leave this undefined until the first render so the HTML placeholder gets cleared.
var displayedRows;
var selectedMessage;
// A closing message keeps its return target until both the dialog and route settle.
var messageToRestoreFocus;
var messageModalPhase = 'hidden';

var loadingProgress;
var msgModal;
var msgModalTitle;
var messageBodyContainer;
var pageDescription;
var openGraphTitle;
var openGraphDescription;
var homeTitle;
var homeDescription;

$(document).ready(function() {
  $(document).ajaxStart(function() { $('html').addClass('wait'); });
  $(document).ajaxStop(function() { $('html').removeClass('wait'); });

  loadingProgress = $('#loading-progress');
  searchInput = document.getElementById('msg-search-input');
  searchSpinner = document.getElementById('message-search-spinner');
  msgModal = $('#message-body-modal');
  msgModalTitle = msgModal.find('.modal-title');
  messageBodyContainer = msgModal.find('.modal-body');
  pageDescription = document.querySelector('meta[name="description"]');
  openGraphTitle = document.querySelector('meta[property="og:title"]');
  openGraphDescription = document.querySelector('meta[property="og:description"]');
  homeTitle = document.title;
  homeDescription = pageDescription.getAttribute('content');

  var visits = parseInt(getCookie(COOKIE_VISITS), 10) || 0;
  setCookie(COOKIE_VISITS, visits + 1);

  Navadmin.messageDownloads.init(messageDownloadChanged, yearMessageBodiesEvicted, isOpenMessageYear);
  Navadmin.messageSearch.init(function(fullMessage) {
    var warmup = crossYearSearchState && crossYearSearchState.fuzzyWarmup;
    if (!fullMessage && warmup && warmup.active) {
      warmup.active = false;
      crossYearSearchState.fuzzyWarmup = null;
    }
    queueMessageFilterLayout();
    msgFilterSearchInputChanged(true);
  });
  Navadmin.onMessageMetadataChanged = function(type) {
    if (activeSearch && activeSearch.type === type) refreshCrossYearSearchSoon();
  };
  $('.message-filters').on('shown.bs.dropdown', function(event) {
    var menu = $(event.relatedTarget).next('.dropdown-menu')[0];
    if (menu && menu.id === 'msg-year-dropdown-menu' && listSelection) {
      $(menu).find('[data-message-year]').each(function() {
        var year = Number(this.getAttribute('data-message-year'));
        updateYearDownloadStatus(year, Navadmin.messageDownloads.progress(listSelection.type, year));
      });
    }
    fitMessageFilterMenu(menu);
  });
  $(window).on('resize', queueMessageFilterLayout);
  queueMessageFilterLayout();
  $(searchInput).on('focus', warmCrossYearSearch).on('input keyup change', function(event) {
    msgFilterSearchInputChanged(!event.originalEvent || event.originalEvent.isTrusted !== false);
  });
  $(searchInput).on('paste cut', function() {
    window.setTimeout(function() { msgFilterSearchInputChanged(true); }, 0);
  });
  $('#nav-app-link').click(navigateToAppStore);
  msgModal.find('.modal-share-link').click(shareUserSelectedMessageLink);
  // Wait for Bootstrap to finish each transition before opening or closing again.
  msgModal.on('show.bs.modal', function() {
    messageModalPhase = 'showing';
  });
  msgModal.on('shown.bs.modal', function() {
    messageModalPhase = 'shown';
    if (selectedMessage) {
      focusMessageHeading();
    } else {
      msgModal.modal('hide');
    }
  });
  msgModal.on('hide.bs.modal', function() {
    messageModalPhase = 'hiding';
    closeMessage();
  });
  msgModal.on('hidden.bs.modal', function() {
    messageModalPhase = 'hidden';
    if (selectedMessage) {
      msgModal.modal('show');
    } else {
      restoreMessageFocus();
    }
  });

  var route = Navadmin.navigation.readRoute(window.location.href);
  if (route.number > 0) {
    Navadmin.navigation.seedMessageHistory(route);
    if (typeof analytics !== 'undefined') {
      analytics.logEvent('LaunchParameter', {
        messageNumber: shortNameForMessage(route.type, route.year, route.number)
      });
    }
  } else {
    setListMetadata(route);
  }
  Navadmin.navigation.updateCanonicalLink();

  Navadmin.messageStore.load(function() {
    setFilterMsgTypeDropdown();
    restoreHistoryRoute();
    Navadmin.navigation.onPopState(restoreHistoryRoute);
    if (typeof Navadmin.startFirebaseAnalytics === 'function') {
      Navadmin.startFirebaseAnalytics();
    }
  });
  getBroadcast(null);
});

/**
 * Set the loading indicator to a loading, error, or hidden state.
 * @param {boolean} loading Whether the list is loading.
 * @param {string|null} [statusText] Text to display. When loading is false,
 *   a message is shown as an error and an empty value hides the indicator.
 */
function setUIInLoadingStatus(loading, statusText) {
  var bar = loadingProgress.find('.progress-bar');
  bar.toggleClass('bg-danger', !loading && !!statusText);
  bar.text(statusText || '');
  loadingProgress.toggle(loading || !!statusText);
}

/**
 * Add a filter link that opens the chosen list in the viewer.
 * @param {jQuery} menu The dropdown menu to append to.
 * @param {string|number} label The displayed menu item text.
 * @param {string} link The URL used for regular browser link actions.
 * @param {MsgType} type The message type to select.
 * @param {number} year The message year, or -1 for the latest available year.
 * @returns {jQuery} The added link.
 */
function addListFilterItem(menu, label, link, type, year) {
  var item = $('<a>', { 'class': 'dropdown-item', 'href': link }).text(label);
  item.click(function(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    if (document.activeElement === this) {
      menu.prev('.dropdown-toggle')[0].focus();
    }
    if (listSelection.type == type && listSelection.year == year) {
      console.log('The selected filter is already active. Refreshing the list.');
      loadMessageList(type, year);
      return;
    }
    Navadmin.navigation.pushList(type, year);
    restoreHistoryRoute();
  });
  menu.append(item);
  return item;
}

/**
 * Populate the message type filter dropdown with the available message types.
 */
function setFilterMsgTypeDropdown() {
  var menu = $('#msg-type-dropdown-menu').empty();
  availableMsgTypes.forEach(function(type) {
    addListFilterItem(menu, msgTypeToString(type), Navadmin.navigation.shareLink(type, -1, -1, false), type, -1);
  });
}

/** Align the menu with its button and shift it only as far as the viewport requires. */
function fitMessageFilterMenu(menu) {
  if (!menu || !$(menu).hasClass('show')) {
    return;
  }
  var anchorLeft = menu.parentNode.getBoundingClientRect().left;
  var maxLeft = document.documentElement.clientWidth - menu.getBoundingClientRect().width;
  menu.style.left = (Math.max(0, Math.min(anchorLeft, maxLeft)) - anchorLeft) + 'px';
}

/** Measure the natural layout before stretching the buttons on a row of their own. */
function queueMessageFilterLayout() {
  if (filterLayoutTimer) return;
  filterLayoutTimer = window.setTimeout(function() {
    filterLayoutTimer = null;
    var filters = $(searchInput.parentNode);
    var buttons = filters.children('.message-filter-buttons')[0];
    filters.removeClass('message-filters-buttons-fill');
    if (searchInput.getBoundingClientRect().top > buttons.getBoundingClientRect().top) {
      filters.addClass('message-filters-buttons-fill');
    }
    filters.find('.dropdown-menu.show').each(function() { fitMessageFilterMenu(this); });
  }, 0);
}

function setMessageFilterLabel(button, label) {
  if (button.text() === label) return;
  button.text(label);
  queueMessageFilterLayout();
}

/**
 * Set the year button label and rebuild its menu when the available years change.
 * @param {MsgType} type The message type whose cached years to list.
 * @param {number} year The year to display. Pass -1 to use the latest cached year.
 * @returns {number} The selected year, or -1 if no year is available.
 */
function setFilterMsgYearDropdown(type, year) {
  var menu = $('#msg-year-dropdown-menu');
  var years = Navadmin.messageStore.years(type).filter(function(availableYear) { return availableYear > 0; });
  var displayedYear = year > 0 ? year : Navadmin.messageStore.latestYear(type);
  var button = $('#msg-year-dropdown');
  setMessageFilterLabel($('#msg-year-dropdown-label'), displayedYear > 0 ? String(displayedYear) : 'N/A');
  updateSelectedYearDownloadStatus(Navadmin.messageDownloads.progress(type, displayedYear));
  var menuKey = type + '/' + years.join(',');
  if (menu.data('messageYearMenuKey') === menuKey) {
    return displayedYear;
  }

  var activeElement = document.activeElement;
  var focusedYearItem = $.contains(menu[0], activeElement) ?
    (activeElement.id || activeElement.getAttribute('href')) : null;
  menu.empty().data('messageYearMenuKey', menuKey);
  years.forEach(function(availableYear) {
    var item = addListFilterItem(menu, availableYear,
      Navadmin.navigation.shareLink(type, availableYear, -1, false), type, availableYear);
    item.attr('data-message-year', availableYear).empty().append(
      $('<span>', { 'class': 'message-year-label' }).text(availableYear),
      $('<span>', { 'class': 'message-year-status' }).hide()
    );
    updateYearDownloadStatus(availableYear, Navadmin.messageDownloads.progress(type, availableYear));
  });
  menu.append($('<div>', { 'class': 'dropdown-divider' }), $('<button>', {
    'class': 'dropdown-item', id: 'msg-download-all-years', type: 'button'
  }).text('Download all years').prop('disabled', !years.length).on('click', function() {
    Navadmin.messageDownloads.queueAll(type);
    $('#msg-year-dropdown').focus();
  }));
  fitMessageFilterMenu(menu[0]);
  if (focusedYearItem) {
    var replacement = menu.find('.dropdown-item:visible').filter(function() {
      return (this.id || this.getAttribute('href')) === focusedYearItem;
    })[0];
    (replacement || button[0]).focus();
  }
  return displayedYear;
}

function isYearDownloadComplete(status) {
  return !!status && status.completed === status.total && !status.temporary;
}

/** Update a year's download indicator without replacing its link. */
function updateYearDownloadStatus(year, status) {
  var indicator = $('#msg-year-dropdown-menu [data-message-year="' + year + '"] .message-year-status');
  if (!indicator.length) {
    return;
  }
  var previous = indicator.data('downloadStatus');
  if (!status) {
    if (previous) indicator.removeData('downloadStatus').empty().hide();
    return;
  }
  if (previous && previous.total === status.total && previous.completed === status.completed &&
      previous.requested === status.requested && previous.active === status.active &&
      previous.temporary === status.temporary && previous.reason === status.reason) {
    return;
  }
  indicator.data('downloadStatus', status);
  var progress = indicator.children('.message-year-progress');
  indicator.children().not(progress).remove();
  if (isYearDownloadComplete(status)) {
    progress.remove();
    indicator.append($('<span>', {
      'class': 'message-year-complete', title: 'Download complete', role: 'img', 'aria-label': 'Download complete'
    }).text('\u2713'));
  } else if (status.total > 0 && (status.requested || status.completed)) {
    if (!progress.length) {
      progress = $('<span>', {
        'class': 'message-year-progress', role: 'progressbar',
        'aria-label': year + ' message download', 'aria-valuemin': 0
      }).append(
        $('<span>', { 'class': 'message-year-progress-fill' }),
        $('<span>', { 'class': 'message-year-progress-count' })
      ).appendTo(indicator);
    }
    renderYearDownloadProgress(progress, status);
  } else {
    progress.remove();
  }
  if (status.reason || (status.requested && status.total === null)) {
    indicator.append($('<span>', { 'class': 'message-year-download-note' })
      .text(status.reason || 'Getting list'));
  }
  indicator.toggle(indicator.children().length > 0);
}

/** Apply the same download progress styling and values to both displays. */
function renderYearDownloadProgress(progress, status) {
  var count = status.completed + '/' + status.total;
  var inMemoryNote = 'Available in the in-memory store until reload';
  var description = count + ' downloaded' + (status.temporary ? '. ' + inMemoryNote : '');
  progress.toggleClass('message-year-progress-active', status.active)
    .toggleClass('message-year-progress-temporary', status.temporary).attr({
      'aria-valuenow': status.completed, 'aria-valuemax': status.total,
      'aria-valuetext': description,
      title: status.temporary ? inMemoryNote : null
    });
  progress.children('.message-year-progress-fill').toggleClass('bg-warning', status.temporary)
    .css('width', (100 * status.completed / status.total) + '%');
  progress.children('.message-year-progress-count').text(count);
  return description;
}

/** Show the selected year's progress or completion within the year button. */
function updateSelectedYearDownloadStatus(status) {
  var progress = $('#msg-year-dropdown-progress');
  var checkmark = $('#msg-year-dropdown-complete');
  var complete = isYearDownloadComplete(status);
  var hideCheckmark = !complete;
  var showProgress = !!status && !complete && status.total > 0 && (status.requested || status.completed > 0);
  var description = complete ? 'Download complete' : '';
  if (showProgress) {
    description = renderYearDownloadProgress(progress, status);
    if (status.reason) description += '. ' + status.reason;
  } else {
    progress.removeClass('message-year-progress-active message-year-progress-temporary')
      .removeAttr('aria-valuenow aria-valuemax aria-valuetext title');
  }
  progress.prop('hidden', !showProgress);
  if (checkmark.prop('hidden') !== hideCheckmark) {
    checkmark.prop('hidden', hideCheckmark);
    queueMessageFilterLayout();
  }
  $('#msg-year-dropdown-progress-description').text(description);
}

function queueYearDownloadStatus(type, year) {
  pendingYearStatus.set(year, type);
  if (!yearStatusTimer) {
    yearStatusTimer = window.setTimeout(function() {
      yearStatusTimer = null;
      pendingYearStatus.forEach(function(messageType, messageYear) {
        if (listSelection.type === messageType) {
          var status = Navadmin.messageDownloads.progress(messageType, messageYear);
          updateYearDownloadStatus(messageYear, status);
          if (listSelection.displayedYear === messageYear) {
            updateSelectedYearDownloadStatus(status);
          }
        }
      });
      pendingYearStatus.clear();
      fitMessageFilterMenu(document.getElementById('msg-year-dropdown-menu'));
    }, 80);
  }
}

function searchRowKey(year, number) {
  return year + '/' + number;
}

function markRowOffline(entry) {
  entry.row[0].cells[0].classList.add('offline-enabled');
  entry.message.availableOffline = true;
}

function isOpenMessageYear(type, year) {
  return !!selectedMessage && selectedMessage.type === type && selectedMessage.year === year;
}

function hasInMemoryMessageBody(type, year, number) {
  var status = Navadmin.messageStore.getMessageBodyStatus(type, year, number);
  return status && status.status === 200 && !status.persistent;
}

/**
 * Refresh the affected year's storage indicators and searchable message bodies after eviction.
 * @param {MsgType} type The message type.
 * @param {number} year The evicted year.
 * @param {Object[]} movedMessageBodyRecords The message body records moved to the in-memory store.
 */
function yearMessageBodiesEvicted(type, year, movedMessageBodyRecords) {
  if (!listSelection || listSelection.type !== type) return;
  queueYearDownloadStatus(type, year);

  if (crossYearSearchState && crossYearSearchState.type === type) {
    var read = crossYearSearchState.readingMessageBodies;
    if (read && read.year === year) read.evicted = true;
    var messageBodiesForYear = crossYearSearchState.messageBodiesByYear.get(year);
    if (messageBodiesForYear) {
      messageBodiesForYear.forEach(function(messageBody, number) {
        if (!hasInMemoryMessageBody(type, year, number)) messageBodiesForYear.delete(number);
      });
    }
    movedMessageBodyRecords.forEach(function(messageBodyRecord) {
      if (messageBodyRecord.status === 200) cacheSearchMessageBody(crossYearSearchState, messageBodyRecord, true);
    });
  }

  if (displayedRows) {
    displayedRows.forEach(function(entry) {
      var message = entry.message;
      if (message.type === type && message.year === year && message.availableOffline) {
        entry.row[0].cells[0].classList.remove('offline-enabled');
        message.availableOffline = false;
      }
    });
  }

  // An in-progress scan may still hold a snapshot of the evicted text or indicators.
  if (activeSearch) {
    var search = activeSearch;
    window.clearTimeout(search.timer);
    activeSearch = { type: search.type, query: search.query, fullMessage: search.fullMessage, matcher: search.matcher };
    scheduleCrossYearSearch(activeSearch, 0);
  }
}

function messageDownloadChanged(type, year, messageBodyRecord, metadataLoadFinished) {
  if (!listSelection || listSelection.type !== type) {
    return;
  }
  queueYearDownloadStatus(type, year);
  if (metadataLoadFinished && listSelection.displayedYear === year) {
    refreshMessageTable(type, year, listSelection.showEmptyIfUnavailable);
  }
  if (messageBodyRecord && messageBodyRecord.status === 200) {
    var saved = Navadmin.messageStore.getMessageBodyStatus(type, year, messageBodyRecord.number);
    if (saved && saved.status === 200 && saved.persistent) {
      if (displayedSearchRows) {
        var result = displayedSearchRows.get(searchRowKey(year, messageBodyRecord.number));
        if (result) markRowOffline(result);
      } else if (listSelection.displayedYear === year && displayedRows) {
        for (var i = 0; i < displayedRows.length; i++) {
          var message = displayedRows[i].message;
          if (message.type === type && message.year === year && message.number === messageBodyRecord.number) {
            markRowOffline(displayedRows[i]);
            break;
          }
        }
      }
    }
    if (crossYearSearchState && crossYearSearchState.type === type &&
        (Navadmin.messageSearch.isFullMessage() || crossYearSearchState.requestedMessageBodyYears.has(year))) {
      cacheSearchMessageBody(crossYearSearchState, messageBodyRecord);
    }
  }
  if (messageBodyRecord && messageBodyRecord.status === 200 && Navadmin.messageSearch.isFullMessage()) {
    refreshCrossYearSearchSoon();
  }
}

/**
 * Display cached rows for the selection, refresh its metadata, and queue the year's message bodies.
 * @param {MsgType} type The message type to display.
 * @param {number} year The year to display, or -1 for the latest available year.
 */
function loadMessageList(type, year) {
  var selection = { type: type, year: year, displayedYear: -1 };
  listSelection = selection;
  if (crossYearSearchState && crossYearSearchState.type !== type) {
    crossYearSearchState = null;
  }
  var listName = shortNameForMessage(type, year).trim();
  console.log('Loading the message list for ' + listName + '.');
  var messageTypeName = msgTypeToString(type);
  setMessageFilterLabel($('#msg-type-dropdown'), messageTypeName);
  searchInput.placeholder = 'Search ' + messageTypeName + ' messages across downloaded years';
  var displayedYear = setFilterMsgYearDropdown(type, year);
  var hasMessageList = refreshMessageTable(type, displayedYear);
  if (document.activeElement === searchInput) warmCrossYearSearch();
  Navadmin.messageDownloads.queueYear(type, displayedYear, true);
  setUIInLoadingStatus(!hasMessageList, hasMessageList ? null : 'Getting available messages');

  getYearsForMsgType(type, [], function onYearsLoaded(yearsResult) {
    if (listSelection !== selection) {
      console.log('Ignoring the year list for ' + listName + ' because the selection changed.');
      if (displayedYear > 0 && !Navadmin.messageStore.messages(type, displayedYear)) {
        getYearsForMsgType(type, [displayedYear], function() {
          Navadmin.messageDownloads.queueYear(type, displayedYear, false);
        }, true);
      }
      return;
    }
    updateArchiveBreadcrumbs(Navadmin.navigation.readRoute(window.location.href));
    var responseYear = setFilterMsgYearDropdown(type, year);
    if (responseYear != displayedYear) {
      console.log('The latest available year for ' + listName + ' changed to ' + responseYear + '.');
      displayedYear = responseYear;
      hasMessageList = refreshMessageTable(type, displayedYear);
      Navadmin.messageDownloads.queueYear(type, displayedYear, true);
      setUIInLoadingStatus(!hasMessageList, hasMessageList ? null : 'Getting available messages');
    }
    var yearName = shortNameForMessage(type, displayedYear).trim();
    if (displayedYear <= 0) {
      setUIInLoadingStatus(false, yearsResult.errorText);
      return;
    }
    getYearsForMsgType(type, [displayedYear], function onMetadataLoaded(metadataResult) {
      Navadmin.messageDownloads.queueYear(type, displayedYear, false);
      if (listSelection !== selection) {
        console.log('Ignoring the refreshed list for ' + yearName + ' because the selection changed.');
        return;
      }
      var requestFailed = metadataResult.requestOutcome === 'error' || yearsResult.requestOutcome === 'error';
      if (refreshMessageTable(type, displayedYear, !requestFailed)) {
        setUIInLoadingStatus(false);
      } else {
        console.log('Could not load the list for ' + yearName + ' and no cached list is available.');
        setUIInLoadingStatus(false, metadataResult.errorText || yearsResult.errorText);
      }
      if (selectedMessage) {
        setMessageTitle(selectedMessage);
      } else {
        updateArchiveBreadcrumbs(Navadmin.navigation.readRoute(window.location.href));
      }
    });
  });
}

/** Synchronize search and sharing metadata for the active route. */
function setPageMetadata(title, description) {
  document.title = title;
  pageDescription.setAttribute('content', description);
  openGraphTitle.setAttribute('content', title);
  openGraphDescription.setAttribute('content', description);
}

/** Publish one breadcrumb list for a confirmed destination, or clear it during navigation. */
function setBreadcrumbStructuredData(route) {
  var breadcrumbJsonLdElement = document.getElementById('viewer-breadcrumb-structured-data');
  var items = route ? Navadmin.navigation.breadcrumbTrail(route) : [];
  if (items.length < 2) {
    if (breadcrumbJsonLdElement) document.head.removeChild(breadcrumbJsonLdElement);
    return;
  }

  var data = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(function(item, index) {
      return { '@type': 'ListItem', position: index + 1, name: item.name, item: item.url };
    })
  });
  if (breadcrumbJsonLdElement) {
    if (breadcrumbJsonLdElement.textContent !== data) breadcrumbJsonLdElement.textContent = data;
    return;
  }

  breadcrumbJsonLdElement = document.createElement('script');
  breadcrumbJsonLdElement.id = 'viewer-breadcrumb-structured-data';
  breadcrumbJsonLdElement.type = 'application/ld+json';
  breadcrumbJsonLdElement.textContent = data;
  document.head.appendChild(breadcrumbJsonLdElement);
}

function updateArchiveBreadcrumbs(route) {
  if (route.number > 0) return;

  var confirmedYear = route.hasExplicitType && route.year > 0 &&
    Navadmin.messageStore.years(route.type).indexOf(route.year) !== -1;
  setBreadcrumbStructuredData(confirmedYear ? route : null);
}

/** Use the requested archive, even when it displays the latest available year. */
function setListMetadata(route) {
  updateArchiveBreadcrumbs(route);
  if (!route.hasExplicitType) {
    setPageMetadata(homeTitle, homeDescription);
    return;
  }

  var archive = msgTypeToString(route.type) + (route.year > 0 ? ' ' + route.year : '');
  setPageMetadata(archive + ' Message Archive | ' + NAVADMIN_VIEWER_TITLE,
    'Browse ' + archive + ' messages by number and subject. Search by subject or full text.');
}

/**
 * Update the selected year's rows or apply a changed cross-year search.
 * @param {MsgType} msgType The message type to display.
 * @param {number} msgYear The resolved year to display.
 * @param {boolean} [showEmptyIfUnavailable] Show the empty row if the completed
 *   requests succeeded without providing a message list.
 * @returns {boolean} Whether a list is cached or the selected year can show an empty row.
 */
function refreshMessageTable(msgType, msgYear, showEmptyIfUnavailable) {
  listSelection.displayedYear = msgYear;
  listSelection.showEmptyIfUnavailable = showEmptyIfUnavailable;

  if (Navadmin.messageSearch.createLiteralMatcher(searchInput.value)) {
    msgFilterSearchInputChanged();
    return !!Navadmin.messageStore.messages(msgType, msgYear) || !!showEmptyIfUnavailable;
  }

  var rows = snapshotMessageRows(msgType, msgYear);
  if (rows === null && showEmptyIfUnavailable) {
    rows = [];
  }
  renderMessageRows(rows);
  return rows !== null;
}

function renderMessageRows(rows) {
  if (!displayedSearchRows) {
    var renderedRows = displayedRows && displayedRows.map(function(entry) { return entry.message; });
    if (JSON.stringify(rows) === JSON.stringify(renderedRows)) return;
  }
  displayedSearchRows = null;

  var table = $('#msg-list-table-body');
  var focusedMessage = findFocusedMessage(table[0]);
  table.empty();
  displayedRows = null;
  if (rows && rows.length === 0) {
    table.append('<tr><td></td><td>No messages available</td><td></td></tr>');
    displayedRows = [];
  } else if (rows) {
    var fragment = document.createDocumentFragment();
    displayedRows = rows.map(function(message) {
      var row = createMessageRow(message);
      fragment.appendChild(row[0]);
      return { message: message, row: row };
    });
    table.append(fragment);
  }

  if (focusedMessage && !focusMessageLink(focusedMessage)) {
    searchInput.focus();
  }
}

/**
 * Identify the rendered message link that would lose focus during a table redraw.
 * @param {HTMLElement} table The message table body.
 * @returns {Object|null} The message represented by the focused row.
 */
function findFocusedMessage(table) {
  var activeElement = document.activeElement;
  if (messageModalPhase !== 'hidden' || !displayedRows || !$.contains(table, activeElement)) {
    return null;
  }

  for (var i = 0; i < displayedRows.length; i++) {
    var entry = displayedRows[i];
    if ($.contains(entry.row[0], activeElement)) {
      return entry.message;
    }
  }
  return null;
}

/**
 * Restore focus to the current visible subject link for a message.
 * @param {Object|null} message The message type, year, and number to locate.
 * @returns {boolean} Whether its subject link received focus.
 */
function focusMessageLink(message) {
  if (!message || !displayedRows) {
    return false;
  }

  for (var i = 0; i < displayedRows.length; i++) {
    var entry = displayedRows[i];
    if (entry.message.type == message.type && entry.message.year == message.year &&
        entry.message.number == message.number) {
      var link = entry.row.find('a:visible')[0];
      if (link) {
        link.focus();
        return document.activeElement === link;
      }
      break;
    }
  }
  return false;
}

/**
 * Copy the fields used to render and filter the table in display order.
 * @param {MsgType} msgType The message type to display.
 * @param {number} msgYear The resolved year to display.
 * @returns {Object[]|null} The row values, or null when the list is unavailable.
 */
function snapshotMessageRows(msgType, msgYear) {
  var messages = Navadmin.messageStore.messages(msgType, msgYear);
  if (!messages) {
    return null;
  }
  return messages.filter(Boolean).reverse().map(function(message) {
    return snapshotMessageRow(msgType, msgYear, message);
  });
}

function snapshotMessageRow(type, year, message) {
  var cached = Navadmin.messageStore.getMessageBodyStatus(type, year, message.number);
  var row = {
    type: type,
    year: year,
    number: message.number,
    title: message.title || '',
    cancelled: !!message.cancelled,
    availableOffline: !!cached && cached.status === 200 && cached.persistent,
    stars: -1,
    views: -1
  };
  (message.actSum || []).forEach(function(activity) {
    if (activity.actType == 'star') {
      row.stars = activity.actNumber;
    } else if (activity.actType == 'view') {
      row.views = activity.actNumber;
    }
  });
  return row;
}

/**
 * Build a clickable table row with the subject, offline indicator, activity counts, and optional highlighted snippet.
 * @param {Object} message The message values captured for this row.
 * @returns {jQuery} The rendered table row.
 */
function createMessageRow(message) {
  var row = $('<tr>').css('cursor', 'pointer').attr('msg-type', msgTypeToString(message.type));
  var number = $('<th>').text(shortNameForMessage(-1, message.year, message.number));
  if (message.availableOffline) {
    number.addClass('offline-enabled');
  }

  var title = message.title || (message.cancelled ? 'N/A' : 'No subject found');
  if (message.cancelled) {
    row.addClass('table-danger');
  }
  var subjectLink = $('<a>', {
    'href': Navadmin.navigation.shareLink(message.type, message.year, message.number, false)
  }).text(title);
  var subject = $('<td>').append(subjectLink);
  if (message.snippet) {
    Navadmin.messageSearch.appendSnippet(subject[0], message.snippet);
  }

  var counts = $('<td>');
  if (message.stars > -1 || message.views > -1) {
    var starCount = $('<p>').text('\u2605\u00a0' + Math.max(message.stars, 0));
    var viewIcon = $('<img>', { 'src': 'assets/eye.svg', 'alt': 'views' });
    var viewCount = $('<p>').text('\u00a0' + Math.max(message.views, 0)).prepend(viewIcon);
    var stats = $('<div>', { 'class': 'stats-box' }).append(starCount, viewCount);
    counts.append(stats);
  }

  row.append(number, subject, counts);
  row.click(function(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    prepareAndShowMessageModal(message.type, message.year, message.number, row);
  });
  return row;
}

function cacheSearchMessageBody(state, messageBodyRecord, onlyIfMissing) {
  var messageBodiesForYear = state.messageBodiesByYear.get(messageBodyRecord.year);
  if (!messageBodiesForYear) {
    messageBodiesForYear = new Map();
    state.messageBodiesByYear.set(messageBodyRecord.year, messageBodiesForYear);
  }
  if (!onlyIfMissing || !messageBodiesForYear.has(messageBodyRecord.number)) {
    messageBodiesForYear.set(messageBodyRecord.number, { text: messageBodyRecord.body });
  }
}

function getCrossYearSearchState() {
  if (!crossYearSearchState) {
    crossYearSearchState = {
      type: listSelection.type,
      messageBodiesByYear: new Map(),
      requestedMessageBodyYears: new Set(),
      requestedTitleYears: new Set()
    };
  }
  return crossYearSearchState;
}

function getFuzzySearch(state, createFuzzySearch) {
  if (!state.fuzzySearch) state.fuzzySearch = createFuzzySearch();
  return state.fuzzySearch;
}

function warmCrossYearSearch() {
  var createFuzzySearch = Navadmin.messageSearch.createFuzzySearch;
  if (!listSelection || activeSearch || !createFuzzySearch || !Navadmin.messageSearch.isFullMessage()) return;
  var state = getCrossYearSearchState();
  if (state.fuzzyWarmup) return;

  getFuzzySearch(state, createFuzzySearch);
  state.fuzzyWarmup = { active: true };
  if (!state.readingMessageBodies) warmFuzzyIndex(state);
}

function warmFuzzyIndex(state, messageBodies) {
  var warmup = state.fuzzyWarmup;
  if (!warmup.started) {
    warmup.started = true;
    messageBodies = crossYearSearchCandidates(state, true).map(function(candidate) { return candidate.messageBody; });
  }
  state.fuzzySearch.addMessageBodies(messageBodies, function() {
    return crossYearSearchState === state && warmup.active;
  }, function() {
    loadCrossYearSearchMessageBodies(state);
  });
}

/**
 * Read cached message bodies one year at a time for Full Message search.
 * @param {Object} state The cross-year search state for the selected message type.
 */
function loadCrossYearSearchMessageBodies(state) {
  if (state.readingMessageBodies) {
    return;
  }
  var year = Navadmin.messageStore.messageBodyYears(state.type).filter(function(candidate) {
    return !state.requestedMessageBodyYears.has(candidate);
  })[0];
  if (!year) {
    if (state.fuzzyWarmup) state.fuzzyWarmup.active = false;
    return;
  }
  var read = { year: year, evicted: false };
  state.readingMessageBodies = read;
  state.requestedMessageBodyYears.add(year);
  Navadmin.messageStore.listMessageBodyRecords(state.type, year, function(messageBodyRecords) {
    state.readingMessageBodies = null;
    if (crossYearSearchState === state) {
      messageBodyRecords.forEach(function(messageBodyRecord) {
        if (messageBodyRecord.status === 200 &&
            (!read.evicted || hasInMemoryMessageBody(state.type, year, messageBodyRecord.number))) {
          cacheSearchMessageBody(state, messageBodyRecord, true);
        }
      });
      var needsMessageBodies = activeSearch && activeSearch.fullMessage;
      if (needsMessageBodies) refreshCrossYearSearchSoon();
      if (state.fuzzyWarmup && state.fuzzyWarmup.active) {
        var messageBodiesForYear = state.messageBodiesByYear.get(year);
        warmFuzzyIndex(state, messageBodiesForYear ? Array.from(messageBodiesForYear.values()) : []);
      } else if (needsMessageBodies) {
        loadCrossYearSearchMessageBodies(state);
      }
    }
  });
}

function loadCrossYearSearchTitles(state) {
  if (state.readingTitles) {
    return;
  }
  var store = Navadmin.messageStore;
  var missing = store.years(state.type).filter(function(year) {
    return year > 0 && !state.requestedTitleYears.has(year) && !store.messages(state.type, year);
  });
  if (!missing.length) {
    return;
  }
  state.readingTitles = true;
  missing.forEach(function(year) { state.requestedTitleYears.add(year); });
  getYearsForMsgType(state.type, missing, function() {
    state.readingTitles = false;
    if (crossYearSearchState === state) {
      missing.forEach(function(year) { queueYearDownloadStatus(state.type, year); });
      if (activeSearch && !activeSearch.fullMessage) loadCrossYearSearchTitles(state);
      hideSearchLoadingIndicatorWhenIdle();
    }
  }, true);
}

function hideSearchLoadingIndicatorWhenIdle() {
  if (searchSpinner.hidden) return;
  var search = activeSearch;
  var loadingCrossYearSearch = search && crossYearSearchState &&
    (search.fullMessage ? crossYearSearchState.readingMessageBodies : crossYearSearchState.readingTitles);
  if (search && (search.timer || search.running || loadingCrossYearSearch)) return;
  searchSpinner.hidden = true;
}

function refreshCrossYearSearchSoon() {
  if (activeSearch) {
    activeSearch.needsRefresh = true;
    scheduleCrossYearSearch(activeSearch, 220);
  }
}

function scheduleCrossYearSearch(search, delay) {
  if (search.timer || search.running) {
    return;
  }
  search.timer = window.setTimeout(function() {
    search.timer = null;
    if (activeSearch === search) {
      runCrossYearSearch(search);
    }
  }, delay);
}

function crossYearSearchCandidates(state, fullMessage) {
  var store = Navadmin.messageStore;
  var candidates = [];
  if (fullMessage) {
    state.messageBodiesByYear.forEach(function(messageBodiesForYear, year) {
      messageBodiesForYear.forEach(function(messageBody, number) {
        candidates.push({ year: year, number: number, messageBody: messageBody });
      });
    });
  } else {
    store.years(state.type).forEach(function(year) {
      var messages = store.messages(state.type, year) || [];
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i]) {
          candidates.push({ year: year, number: messages[i].number, message: messages[i] });
        }
      }
    });
  }
  return candidates;
}

function crossYearSearchResult(search, candidate, metadataByYear, fuzzyMatches) {
  var message = candidate.message;
  if (!search.fullMessage) {
    return search.matcher.test(message.title || '') ? { message: snapshotMessageRow(search.type, candidate.year, message) } : null;
  }

  var match = Navadmin.messageSearch.matchMessageBody(candidate.messageBody, search.matcher, fuzzyMatches);
  if (!match) {
    return null;
  }

  var messages = metadataByYear.get(candidate.year);
  if (!messages) {
    messages = new Map();
    (Navadmin.messageStore.messages(search.type, candidate.year) || []).forEach(function(metadata) {
      if (metadata) messages.set(metadata.number, metadata);
    });
    metadataByYear.set(candidate.year, messages);
  }
  message = messages.get(candidate.number) || { number: candidate.number };
  var row = snapshotMessageRow(search.type, candidate.year, message);
  row.snippet = match.snippet;
  return { message: row, fuzzyScore: match.fuzzyScore };
}

function runCrossYearSearch(search) {
  search.running = true;
  search.needsRefresh = false;
  var state = crossYearSearchState;
  if (state.fuzzyWarmup) state.fuzzyWarmup.active = false;
  if (search.fullMessage) {
    loadCrossYearSearchMessageBodies(state);
  } else {
    loadCrossYearSearchTitles(state);
  }

  var candidates = crossYearSearchCandidates(state, search.fullMessage);
  var metadataByYear = new Map();
  var rows = [];
  var rowIndex = new Map();
  var position = 0;
  var fuzzyMatches;
  function scanBatch() {
    if (activeSearch !== search) {
      return;
    }
    var deadline = Date.now() + 8;
    // Yield both the text scan and detached row construction to the browser.
    do {
      var candidate = candidates[position++];
      if (!candidate) break;
      var result = crossYearSearchResult(search, candidate, metadataByYear, fuzzyMatches);
      if (result) {
        var message = result.message;
        var key = searchRowKey(candidate.year, candidate.number);
        var entry = displayedSearchRows && displayedSearchRows.get(key);
        if (!entry || JSON.stringify(entry.message) !== JSON.stringify(message)) {
          entry = { message: message, row: createMessageRow(message) };
        }
        entry.fuzzyScore = result.fuzzyScore;
        rows.push(entry);
        rowIndex.set(key, entry);
      }
    } while (position < candidates.length && Date.now() < deadline);

    if (position < candidates.length) {
      window.setTimeout(scanBatch, 0);
      return;
    }
    if (search.fullMessage) {
      rows.sort(function(a, b) {
        if (!a.fuzzyScore && b.fuzzyScore) return -1;
        if (a.fuzzyScore && !b.fuzzyScore) return 1;
        return b.fuzzyScore - a.fuzzyScore || b.message.year - a.message.year || b.message.number - a.message.number;
      });
    }
    showCrossYearSearchRows(rows, rowIndex);
    search.running = false;
    if (search.needsRefresh) {
      scheduleCrossYearSearch(search, 220);
    } else {
      hideSearchLoadingIndicatorWhenIdle();
    }
  }
  var createFuzzySearch = search.fullMessage && Navadmin.messageSearch.createFuzzySearch;
  search.createFuzzySearch = createFuzzySearch;
  if (createFuzzySearch) {
    var fuzzySearch = getFuzzySearch(state, createFuzzySearch);
    var messageBodies = candidates.map(function(candidate) { return candidate.messageBody; });
    fuzzySearch.search(search.query, messageBodies, function() {
      return activeSearch === search;
    }, function(matches) {
      fuzzyMatches = matches;
      scanBatch();
    });
  } else {
    scanBatch();
  }
}

function showCrossYearSearchRows(rows, rowIndex) {
  var table = document.getElementById('msg-list-table-body');
  var focusedMessage = findFocusedMessage(table);
  if (!displayedSearchRows || !rows.length) {
    $(table).empty();
  } else {
    displayedSearchRows.forEach(function(entry, key) {
      if (rowIndex.get(key) !== entry) entry.row.remove();
    });
  }

  var previousRow = table.firstElementChild;
  var fragment = document.createDocumentFragment();
  rows.forEach(function(entry) {
    var row = entry.row[0];
    if (row === previousRow) {
      if (fragment.firstChild) table.insertBefore(fragment, previousRow);
      previousRow = previousRow.nextElementSibling;
    } else {
      var message = entry.message;
      if (!message.availableOffline) {
        var saved = Navadmin.messageStore.getMessageBodyStatus(message.type, message.year, message.number);
        if (saved && saved.status === 200 && saved.persistent) markRowOffline(entry);
      }
      fragment.appendChild(row);
    }
  });
  if (fragment.firstChild) table.appendChild(fragment);

  displayedRows = rows;
  displayedSearchRows = rowIndex;
  if (focusedMessage && !table.contains(document.activeElement) && !focusMessageLink(focusedMessage)) {
    searchInput.focus();
  }
}

/**
 * Filter the selected message type across years, showing literal matches first.
 * Full Message searches cached message bodies and Title Only searches subjects.
 * Clearing the query restores the selected year's list.
 * @param {boolean} [userInitiated] Show the header spinner for changes made through the search controls.
 */
function msgFilterSearchInputChanged(userInitiated) {
  if (!listSelection) {
    return;
  }
  var query = searchInput.value;
  var fullMessage = Navadmin.messageSearch.isFullMessage();
  var createFuzzySearch = fullMessage && Navadmin.messageSearch.createFuzzySearch;
  if (activeSearch && activeSearch.query === query && activeSearch.fullMessage === fullMessage &&
      activeSearch.type === listSelection.type) {
    if (createFuzzySearch && activeSearch.createFuzzySearch !== createFuzzySearch) {
      refreshCrossYearSearchSoon();
    }
    return;
  }
  var previousSearch = activeSearch;
  if (previousSearch) {
    window.clearTimeout(previousSearch.timer);
    if (previousSearch.type !== listSelection.type && displayedSearchRows) renderMessageRows(null);
  }
  activeSearch = null;
  var matcher = Navadmin.messageSearch.createLiteralMatcher(query);
  if (!userInitiated || !matcher) {
    hideSearchLoadingIndicatorWhenIdle();
  }
  if (!matcher) {
    if (crossYearSearchState) crossYearSearchState.requestedTitleYears.clear();
    if (previousSearch || displayedSearchRows) {
      refreshMessageTable(listSelection.type, listSelection.displayedYear, listSelection.showEmptyIfUnavailable);
    }
    if (document.activeElement === searchInput) warmCrossYearSearch();
    return;
  }
  getCrossYearSearchState();
  activeSearch = { type: listSelection.type, query: query, fullMessage: fullMessage, matcher: matcher };
  if (userInitiated) searchSpinner.hidden = false;
  scheduleCrossYearSearch(activeSearch, 140);
}

/**
 * Restore the list and modal from the current URL and existing history state.
 */
function restoreHistoryRoute() {
  var entry = Navadmin.navigation.readHistory();
  Navadmin.navigation.updateCanonicalLink();
  var route = entry.route;
  var list = entry.list;
  var hasMessage = route.number > 0;
  var routeName = shortNameForMessage(route.type, route.year, route.number).trim();
  console.log('Restoring ' + routeName + ' from the current URL.');

  if (!hasMessage && selectedMessage) {
    messageToRestoreFocus = selectedMessage;
    selectedMessage = null;
  }
  if (!listSelection || listSelection.type != list.type || listSelection.year != list.year) {
    loadMessageList(list.type, list.year);
  }
  if (hasMessage) {
    showMessage(route.type, route.year, route.number, entry.depth, null, entry.opener);
  } else {
    if (messageModalPhase === 'shown') {
      msgModal.modal('hide');
    }
    setListMetadata(route);
    restoreMessageFocus();
  }
}

/**
 * Open a message from the table and add its browser history entry.
 * @param {MsgType} type The message type to open.
 * @param {number} year The message year.
 * @param {number} number The message number.
 * @param {jQuery|null} [row] The table row whose cursor shows download progress.
 */
function prepareAndShowMessageModal(type, year, number, row) {
  if (selectedMessage && selectedMessage.type == type &&
      selectedMessage.year == year && selectedMessage.number == number) {
    console.log('The requested message is already selected.');
    return;
  }
  var opener = selectedMessage ? selectedMessage.opener : null;
  if (!selectedMessage && row) {
    opener = { type: type, year: year, number: number };
  }
  var depth = Navadmin.navigation.pushMessage(type, year, number, listSelection, selectedMessage, opener);
  showMessage(type, year, number, depth, row, opener);
}

/**
 * Show the message modal and fetch the message metadata and message body as needed.
 * @param {MsgType} type The message type to display.
 * @param {number} year The message year.
 * @param {number} number The message number.
 * @param {number} depth The number of browser history entries to go back when
 *   closing the modal. Use 0 when there is no originating list entry.
 * @param {jQuery|null} [row] The table row whose cursor shows download progress.
 * @param {Object|null} [opener] The original subject link’s type, year, and number.
 */
function showMessage(type, year, number, depth, row, opener) {
  var message = { type: type, year: year, number: number, depth: depth, opener: opener };
  selectedMessage = message;
  messageToRestoreFocus = null;
  setBreadcrumbStructuredData(null);

  var messageName = setMessageTitle(message);
  if (messageModalPhase === 'shown') {
    // Move focus before replacing the message field in an already open dialog.
    focusMessageHeading();
  }
  var spinner = $('<span>', {
    'class': 'spinner-border spinner-border-sm mr-2',
    'aria-hidden': 'true'
  });
  messageBodyContainer.empty().append(spinner, document.createTextNode('Retrieving message\u2026'));
  if (messageModalPhase === 'hidden') {
    msgModal.modal('show');
  }
  if (row) {
    row.css('cursor', 'progress');
  }

  if (!Navadmin.messageStore.findMessage(type, year, number)) {
    console.log('No cached list entry for ' + messageName + '. Requesting its year metadata.');
    getYearsForMsgType(type, [year], function() {
      if (selectedMessage === message) {
        setMessageTitle(message);
      }
    });
  }

  getMessageBody(type, year, number, function(messageBody, errorText) {
    if (row) {
      row.css('cursor', 'pointer');
    }

    if (selectedMessage !== message) {
      console.log('Ignoring the message body for ' + messageName + ' because the modal selection changed.');
      return;
    }

    message.excerpt = messageBody ? getMessageExcerpt(messageBody) : '';
    setMessageTitle(message);
    if (!messageBody) {
      var messageError = errorText || 'Message not found.';
      console.log('Could not display ' + messageName + '. ' + messageError);
      messageBodyContainer.text(messageError);
      return;
    }
    var messageText = $('<textarea>', {
      'class': 'form-control message-text',
      'aria-label': 'Message text',
      'readonly': true,
      'rows': 12,
      'wrap': 'soft'
    });
    messageText[0].defaultValue = messageBody;
    messageBodyContainer.empty().append(messageText);
    setBreadcrumbStructuredData(Navadmin.navigation.readRoute(window.location.href));

    if (typeof analytics !== 'undefined') {
      analytics.logEvent('ViewedMessage', { messageNumber: messageName });
    }
    sendViewActivity(type, year, number);
  });
}

/**
 * Start reading a newly opened or selected message at its heading.
 */
function focusMessageHeading() {
  msgModal.scrollTop(0);
  msgModalTitle[0].focus();
}

/**
 * Return focus to the opener after both the modal and list route settle.
 * Direct links and missing rows use the year filter as the return point.
 */
function restoreMessageFocus() {
  if (!messageToRestoreFocus || messageModalPhase !== 'hidden') {
    return;
  }

  var route = Navadmin.navigation.readRoute(window.location.href);
  if (route.number > 0 || listSelection.type !== route.type || listSelection.year !== route.year) {
    return;
  }

  var opener = messageToRestoreFocus.opener;
  messageToRestoreFocus = null;
  if (!focusMessageLink(opener)) {
    document.getElementById('msg-year-dropdown').focus();
  }
}

function normalizeMetadataText(text) {
  return text.replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

/** Summarize the opening remarks while skipping transmission headers. */
function getMessageExcerpt(body) {
  var remarks = /^(?:RMKS|GENTEXT\/REMARKS)\//im.exec(body);
  if (!remarks && /^(?:UNCLAS|ROUTINE\b|FM |MSGID\/|SUBJ\/)/im.test(body)) {
    return '';
  }

  var content = remarks ? body.slice(remarks.index + remarks[0].length) : body;
  content = content.split(/^(?:BT|NNNN|UNCLAS(?:SIFIED)?(?:\/\/)?)\s*$/im)[0];
  content = normalizeMetadataText(content).replace(/^\d+\.\s+/, '');
  var maximumLength = 160;
  if (content.length <= maximumLength) {
    return content;
  }
  return content.slice(0, maximumLength - 1).replace(/\s+\S*$/, '') + '\u2026';
}

/**
 * Update the dialog heading and search metadata as the subject and body arrive.
 * @param {Object} message The current message selection.
 * @returns {string} The short message name used for logging and analytics.
 */
function setMessageTitle(message) {
  var name = shortNameForMessage(message.type, message.year, message.number);
  var cached = Navadmin.messageStore.findMessage(message.type, message.year, message.number);
  var subject = cached && cached.title || '';
  msgModalTitle.text(name + (subject ? ' - ' + subject : ''));
  subject = normalizeMetadataText(subject);
  var title = name + (subject ? ' \u2013 ' + subject : '');
  var description = message.excerpt || (subject ? title : name + ' in the NAVADMIN Viewer message archive.');
  setPageMetadata(title + ' | ' + NAVADMIN_VIEWER_TITLE, description);
  return name;
}

/**
 * Close the selected message and restore the originating list in browser history.
 */
function closeMessage() {
  if (!selectedMessage) {
    return;
  }
  var depth = selectedMessage.depth;
  messageToRestoreFocus = selectedMessage;
  selectedMessage = null;
  Navadmin.navigation.closeMessage(listSelection, depth);
  if (!depth) {
    setListMetadata(Navadmin.navigation.readRoute(window.location.href));
  }
}

/**
 * Show the shareable URL for the message currently open in the modal.
 * @param {jQuery.Event} e The Share button click.
 */
function shareUserSelectedMessageLink(e) {
  e.preventDefault();
  if (selectedMessage) {
    var link = Navadmin.navigation.shareLink(selectedMessage.type, selectedMessage.year, selectedMessage.number, true);
    window.prompt('Copy the below share link to clipboard (\u229e Ctrl+C / \uf8ff \u2318+C)', link);
  }
}

/**
 * Open the store listing for the visitor’s platform.
 * @param {jQuery.Event} e The App link click.
 */
function navigateToAppStore(e) {
  e.preventDefault();
  var appLink = getMobileOperatingSystem() == 'android'
    ? 'https://play.google.com/store/apps/details?id=com.ansonliu.navadmin'
    : 'https://apps.apple.com/us/app/navadmin-viewer/id1345135985';
  window.location.assign(appLink);
}
