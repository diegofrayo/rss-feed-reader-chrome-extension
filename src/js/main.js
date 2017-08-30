const OTHER_BOOKMARKS_FOLDER_ID = '2';
const RSS_FEEDS_FOLDER_NAME = 'RSS Reader - Feeds';

let rssFeedsFolderId = '';
let rssFeedSelected = {};
let rssFeedSelectedLinks = [];
let rssFeedsList = [];

const BookmarksUtil = {

	createBookmark: (bookmark) => {

		const dfd = jQuery.Deferred();

		chrome.bookmarks.create(bookmark, (newBookmark) => {
			dfd.resolve(newBookmark);
		});

		return dfd.promise();
	},

	removeBookmark: (bookmark) => {

		const dfd = jQuery.Deferred();

		chrome.bookmarks.remove(bookmark.id, () => {

			rssFeedsList = rssFeedsList.filter((item) => {
				return item.id !== bookmark.id;
			});

			RSSFeedsUtil.removeRSSFeedLinks(bookmark.id);

			dfd.resolve('finished');
		});

		return dfd.promise();
	}

};

const UI_Util = {

	getRSSFeedListItemTemplate: (rssFeed) => {

		const displayNewArticlesNumber = rssFeed.newArticlesNumber === 0 ? "display:none" : "display:inline-block";

		return `<li class="collection-item rss-feed-list-item" data-rss-feed-id="${rssFeed.id}">
					${rssFeed.title}
					<i class="material-icons right grey-text text-lighten-3">send</i>
					<span class="new badge right red darken-3" style="${displayNewArticlesNumber}">${rssFeed.newArticlesNumber}</span>
				</li>`;
	},

	getRSSFeedLinkTemplate: (index, link) => {

		const displayIsNew = !link.isNew ? "display:none" : "display:block";

		return `<li data-rss-feed-link-url="${link.url}" target="_blank" class="collection-item rss-feed-link" data-rss-feed-link-index="${index}">
					<p class="rss-feed-link-title">${link.title}</p>
					<p class="rss-feed-link-date">${link.pubDate}</p>
					<span class="new badge right red darken-3 rss-feed-link-is-new" style="${displayIsNew}"></span>
				</li>`;
	},

	printRSSFeedsList: (rssFeedsList) => {

		RSSFeedsUtil.sortRSSFeedsByName(rssFeedsList);

		let html = '';
		rssFeedsList.forEach((rssFeed) => {
			html += UI_Util.getRSSFeedListItemTemplate(rssFeed);
		});

		jQuery('#rss-feeds-list-ul').html(html);
		OnClickFunctions.attachOnClickEventToRSSFeedItem();
	},

	printRSSFeedLinks: (links) => {

		let html = '';
		links.forEach((link, index) => {
			html += UI_Util.getRSSFeedLinkTemplate(index, link);
		});

		jQuery('#rss-feed-links-ul').html(html).show();
		OnClickFunctions.attachOnClickEventToRSSFeedLinkItem();
	},

	cardsTransition: (containerToHide, containerToShow, callback) => {
		$(containerToHide).fadeOut('slow', () => {
			$(containerToShow).fadeIn(500);
			if (callback) {
				callback();
			}
		});
	}

};

const RSSFeedsUtil = {

	sortRSSFeedsByName: (rssFeedsList) => {
		rssFeedsList.sort((a, b) => {
			return a.title > b.title;
		});
	},

	getRSSFeedById: (rssFeedsList, rssFeedId) => {

		const results = rssFeedsList.filter((item) => {
			return item.id == rssFeedId;
		})[0];

		return results;
	},

	fetchRSSFeedsList: () => {

		chrome.bookmarks.getChildren(OTHER_BOOKMARKS_FOLDER_ID, (results) => {

			const filterResults = results.filter((item) => {
				return item.title === RSS_FEEDS_FOLDER_NAME;
			});

			if (filterResults.length === 0) {

				$.when(BookmarksUtil.createBookmark({
						parentId: OTHER_BOOKMARKS_FOLDER_ID,
						title: RSS_FEEDS_FOLDER_NAME
					}))
					.then((newBookmark) => {
						rssFeedsFolderId = newBookmark.id;
					});

			} else {

				rssFeedsFolderId = filterResults[0].id;

				chrome.bookmarks.getChildren(rssFeedsFolderId, (results) => {

					rssFeedsList = rssFeedsList.concat(results);

					rssFeedsList.forEach((item) => {

						let newArticlesNumber = 0;
						const links = RSSFeedsUtil.getRSSFeedLinks(item.id);

						if (links) {
							links.forEach((link) => {
								if (link.isNew === true) {
									newArticlesNumber++;
								}
							});
						}

						item.newArticlesNumber = newArticlesNumber;
					});

					UI_Util.printRSSFeedsList(rssFeedsList);
				});

			}

		});

	},

	checkIfLinkIsNew: (links, link) => {

		for (let i = 0, length = links.length; i < length; i++) {
			if (link.title === links[i].title) {
				return false;
			}
		}

		return true;
	},

	getRSSFeedLinks: (rssFeedId) => {
		try {
			return JSON.parse(window.localStorage.getItem('rss_feed_' + rssFeedId)).links;
		} catch (e) {
			return null;
		}
	},

	saveRSSFeedLinks: (links, rssFeedId) => {
		window.localStorage.setItem('rss_feed_' + rssFeedId, JSON.stringify({
			links
		}));
	},

	removeRSSFeedLinks: (rssFeedId) => {
		window.localStorage.removeItem('rss_feed_' + rssFeedId);
	},

	rejectSyncRSSFeed: (rssFeed, defered) => {
		rssFeed.newArticlesNumber = 0;
		RSSFeedsUtil.removeRSSFeedLinks(rssFeed.id);
		return defered.reject(rssFeed);
	},

	syncRSSFeed: (rssFeed, forceCache) => {

		const dfd = jQuery.Deferred();
		const rssFeedLinksCache = RSSFeedsUtil.getRSSFeedLinks(rssFeed.id);
		let newArticlesNumber = rssFeed.newArticlesNumber;

		if (rssFeedLinksCache && !forceCache) {

			dfd.resolve({
				links: rssFeedLinksCache
			});

		} else {

			$.ajax('https://crossorigin.me/' + rssFeed.url, {
				accepts: {
					xml: 'application/rss+xml'
				},
				dataType: 'xml',
				success: (data) => {

					try {

						let links = [];

						$(data).find('item').each(function () {
							const link = $(this);
							links.push({
								pubDate: link.find('pubDate').text().substring(0, 25),
								title: link.find('title').text().trim(),
								url: link.find('link').text().trim()
							});
						});

						if (links.length === 0) {
							return RSSFeedsUtil.rejectSyncRSSFeed(rssFeed, dfd);
						}

						const rssFeedLinksCache = RSSFeedsUtil.getRSSFeedLinks(rssFeed.id);

						if (rssFeedLinksCache) {

							links.forEach((link) => {

								const isLinkNew = RSSFeedsUtil.checkIfLinkIsNew(rssFeedLinksCache, link);
								link.isNew = isLinkNew;

								if (isLinkNew) {
									newArticlesNumber++;
								}

							});

							rssFeed.newArticlesNumber = newArticlesNumber;

						} else {
							newArticlesNumber = links.length;
							links.forEach((link) => {
								link.isNew = true;
							});
						}

						RSSFeedsUtil.saveRSSFeedLinks(links, rssFeed.id);
						rssFeed.newArticlesNumber = newArticlesNumber;

						dfd.resolve({
							links
						});

					} catch (e) {
						RSSFeedsUtil.rejectSyncRSSFeed(rssFeed, dfd);
					}

				},
				error: (data) => {
					RSSFeedsUtil.rejectSyncRSSFeed(rssFeed, dfd);
				}
			});

		}

		return dfd.promise();
	}

};

const OnClickFunctions = {

	backToHomeView: function () {
		UI_Util.printRSSFeedsList(rssFeedsList);
		UI_Util.cardsTransition($(this).data('parent-container-id'), '#rss-feeds-list-container');
	},

	showAddRSSFeedView: () => {
		UI_Util.cardsTransition('#rss-feeds-list-container', '#add-rss-feed-container');
	},

	syncAllRSSFeeds: () => {

		const defereds = rssFeedsList.map((rssFeed) => {
			return RSSFeedsUtil.syncRSSFeed(rssFeed, true);
		});

		$.when.apply($, defereds).then(() => {
			UI_Util.printRSSFeedsList(rssFeedsList);
		}, () => {
			UI_Util.printRSSFeedsList(rssFeedsList);
		});
	},

	addRSSFeed: (event) => {

		event.preventDefault();

		const url = $('#input-url').val().trim();
		const title = $('#input-title').val().trim();

		if (url && title) {

			$.when(BookmarksUtil.createBookmark({
				parentId: rssFeedsFolderId,
				title,
				url
			})).then((newBookmark) => {
				newBookmark.newArticlesNumber = 0;
				rssFeedsList.push(newBookmark);
				UI_Util.cardsTransition('#add-rss-feed-container', '#rss-feeds-list-container');
				UI_Util.printRSSFeedsList(rssFeedsList);
				$('#input-url, #input-title').val('');
			});

		}
	},

	removeRSSFeed: () => {
		BookmarksUtil.removeBookmark(rssFeedSelected)
			.then(() => {
				UI_Util.cardsTransition('#rss-feed-details-container', '#rss-feeds-list-container');
				UI_Util.printRSSFeedsList(rssFeedsList);
			});
	},

	syncRSSFeed: () => {

		jQuery('#rss-feed-links-ul').hide();
		jQuery('#error-message').hide();

		$.when(RSSFeedsUtil.syncRSSFeed(rssFeedSelected, true))
			.then((result) => {
				UI_Util.printRSSFeedLinks(result.links);
			}, (error) => {
				jQuery('#error-message').text('RSS Feed content cannot be loaded.').show();
			});
	},

	markAsReadAllRSSFeedLinks: () => {

		const links = RSSFeedsUtil.getRSSFeedLinks(rssFeedSelected.id);

		if (links) {

			links.forEach((link) => {
				link.isNew = false;
			});

			RSSFeedsUtil.saveRSSFeedLinks(links, rssFeedSelected.id);
			rssFeedSelected.newArticlesNumber = 0;
			UI_Util.printRSSFeedLinks(links);
		}

	},

	selectRSSFeedListItem: function () {

		const item = $(this);
		rssFeedSelected = RSSFeedsUtil.getRSSFeedById(rssFeedsList, item.data('rss-feed-id'));

		const callback = () => {
			jQuery('#rss-feed-links-ul').scrollTop(0).hide();
			jQuery('#error-message').hide();
			$.when(RSSFeedsUtil.syncRSSFeed(rssFeedSelected))
				.then((result) => {
					UI_Util.printRSSFeedLinks(result.links);
				}, (error) => {
					jQuery('#error-message').text('RSS Feed content cannot be loaded.').show();
				});
		};

		UI_Util.cardsTransition('#rss-feeds-list-container', '#rss-feed-details-container', callback);
		$('#rss-feed-title').text(rssFeedSelected.title);
	},

	selectRSSFeedLink: function () {

		const link = $(this);

		chrome.tabs.create({
			url: link.data('rss-feed-link-url'),
			active: false
		});

		link.find('.badge').hide();

		if (rssFeedSelected.newArticlesNumber > 0) {
			rssFeedSelected.newArticlesNumber = rssFeedSelected.newArticlesNumber - 1;
		}

		const links = RSSFeedsUtil.getRSSFeedLinks(rssFeedSelected.id);
		links[parseInt(link.data('rss-feed-link-index'))].isNew = false;
		RSSFeedsUtil.saveRSSFeedLinks(links, rssFeedSelected.id);
	},

	attachOnClickEventToRSSFeedItem: () => {
		$('.rss-feed-list-item').on('click', OnClickFunctions.selectRSSFeedListItem);
	},

	attachOnClickEventToRSSFeedLinkItem: () => {
		$('.rss-feed-link').on('click', OnClickFunctions.selectRSSFeedLink);
	}

};

$(document).ready(() => {

	RSSFeedsUtil.fetchRSSFeedsList();

	// General
	$('.back-to-home-btn').on('click', OnClickFunctions.backToHomeView);

	// RSS Feeds List View
	$('#show-add-rss-feed-view-btn').on('click', OnClickFunctions.showAddRSSFeedView);
	$('#update-all-rss-feeds-btn').on('click', OnClickFunctions.syncAllRSSFeeds);

	// Add RSS Feeds View
	$('#add-rss-feed-form').on('submit', OnClickFunctions.addRSSFeed);

	// RSS Feed Details View
	$('#remove-rss-feed-btn').on('click', OnClickFunctions.removeRSSFeed);
	$('#sync-rss-feed-btn').on('click', OnClickFunctions.syncRSSFeed);
	$('#check-all-rss-feed-btn').on('click', OnClickFunctions.markAsReadAllRSSFeedLinks);

});