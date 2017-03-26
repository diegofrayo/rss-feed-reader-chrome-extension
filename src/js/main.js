const OTHER_BOOKMARKS_FOLDER_ID = '2';
const RSS_CHANNELS_FOLDER_NAME = 'RSS Reader - Channels';

let rssChannelsFolderId = '';
let rssChannelSelected = {};
let rssChannelSelectedLinks = [];
let rssChannelsList = [];

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

			rssChannelsList = rssChannelsList.filter((item) => {
				return item.id !== bookmark.id;
			});

			RSSChannelsUtil.removeRSSChannelLinks(bookmark.id);

			dfd.resolve('finished');
		});

		return dfd.promise();
	}

};

const UI_Util = {

	getRSSChannelListItemTemplate: (rssChannel) => {

		const displayNewArticlesNumber = rssChannel.newArticlesNumber === 0 ? "display:none" : "display:inline-block";

		return `<li class="collection-item rss-channel-list-item" data-rss-channel-id="${rssChannel.id}">
					${rssChannel.title}
					<i class="material-icons right grey-text text-lighten-3">send</i>
					<span class="new badge right red darken-3" style="${displayNewArticlesNumber}">${rssChannel.newArticlesNumber}</span>
				</li>`;
	},

	getRSSChannelLinkTemplate: (index, link) => {

		const displayIsNew = !link.isNew ? "display:none" : "display:block";

		return `<li data-rss-channel-link-url="${link.url}" target="_blank" class="collection-item rss-channel-link" data-rss-channel-link-index="${index}">
					<p class="rss-channel-link-title">${link.title}</p>
					<p class="rss-channel-link-date">${link.pubDate}</p>
					<span class="new badge right red darken-3 rss-channel-link-is-new" style="${displayIsNew}"></span>
				</li>`;
	},

	printRSSChannelsList: (rssChannelsList) => {

		RSSChannelsUtil.sortRSSChannelsByName(rssChannelsList);

		let html = '';
		rssChannelsList.forEach((rssChannel) => {
			html += UI_Util.getRSSChannelListItemTemplate(rssChannel);
		});

		jQuery('#rss-channels-list-ul').html(html);
		OnClickFunctions.attachOnClickEventToRSSChannelItem();
	},

	printRSSChannelLinks: (links) => {

		let html = '';
		links.forEach((link, index) => {
			html += UI_Util.getRSSChannelLinkTemplate(index, link);
		});

		jQuery('#rss-channel-links-ul').html(html).show();
		OnClickFunctions.attachOnClickEventToRSSChannelLinkItem();
	},

	cardsTransition: (containerToHide, containerToShow, callback) => {
		$(containerToHide).fadeOut('slow', () => {
			$(containerToShow).fadeIn(1000);
			if (callback) {
				callback();
			}
		});
	}

};

const RSSChannelsUtil = {

	sortRSSChannelsByName: (rssChannelsList) => {
		rssChannelsList.sort((a, b) => {
			return a.title > b.title;
		});
	},

	getRSSChannelById: (rssChannelsList, rssChannelId) => {

		const results = rssChannelsList.filter((item) => {
			return item.id == rssChannelId;
		});

		if (results.length === 1) {
			return results[0];
		}

		return null;
	},

	fetchRSSChannelsList: () => {

		chrome.bookmarks.getChildren(OTHER_BOOKMARKS_FOLDER_ID, (results) => {

			const filterResults = results.filter((item) => {
				return item.title === RSS_CHANNELS_FOLDER_NAME;
			});

			if (filterResults.length === 0) {

				$.when(BookmarksUtil.createBookmark({
						parentId: OTHER_BOOKMARKS_FOLDER_ID,
						title: RSS_CHANNELS_FOLDER_NAME
					}))
					.then((newBookmark) => {
						rssChannelsFolderId = newBookmark.id;
					});

			} else {

				rssChannelsFolderId = filterResults[0].id;

				chrome.bookmarks.getChildren(rssChannelsFolderId, (results) => {

					rssChannelsList = rssChannelsList.concat(results);

					rssChannelsList.forEach((item) => {

						let newArticlesNumber = 0;
						const links = RSSChannelsUtil.getRSSChannelLinks(item.id);

						if (links) {
							links.forEach((link) => {
								if (link.isNew === true) {
									newArticlesNumber++;
								}
							});
						}

						item.newArticlesNumber = newArticlesNumber;
					});

					UI_Util.printRSSChannelsList(rssChannelsList);
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

	getRSSChannelLinks: (rssChannelId) => {
		try {
			return JSON.parse(window.localStorage.getItem('rss_channel_' + rssChannelId)).links;
		} catch (e) {
			return null;
		}
	},

	saveRSSChannelLinks: (links, rssChannelId) => {
		window.localStorage.setItem('rss_channel_' + rssChannelId, JSON.stringify({
			links
		}));
	},

	removeRSSChannelLinks: (rssChannelId) => {
		window.localStorage.removeItem('rss_channel_' + rssChannelId);
	},

	rejectSyncRSSChannel: (rssChannel, defered) => {
		rssChannel.newArticlesNumber = 0;
		RSSChannelsUtil.removeRSSChannelLinks(rssChannel.id);
		return defered.reject(rssChannel);
	},

	syncRSSChannel: (rssChannel, forceCache) => {

		const dfd = jQuery.Deferred();
		const rssChannelLinksCache = RSSChannelsUtil.getRSSChannelLinks(rssChannel.id);
		let newArticlesNumber = rssChannel.newArticlesNumber;

		if (rssChannelLinksCache && !forceCache) {

			dfd.resolve({
				links: rssChannelLinksCache
			});

		} else {

			$.ajax('https://crossorigin.me/' + rssChannel.url, {
				accepts: {
					xml: 'application/rss+xml'
				},
				dataType: 'xml',
				success: (data) => {

					try {

						let links = [];

						$(data).find('item').each(function() {
							const link = $(this);
							links.push({
								pubDate: link.find('pubDate').text().substring(0, 25),
								title: link.find('title').text().trim(),
								url: link.find('link').text().trim()
							});
						});

						if (links.length === 0) {
							return RSSChannelsUtil.rejectSyncRSSChannel(rssChannel, dfd);
						}

						const rssChannelLinksCache = RSSChannelsUtil.getRSSChannelLinks(rssChannel.id);

						if (rssChannelLinksCache) {

							links.forEach((link) => {

								const isLinkNew = RSSChannelsUtil.checkIfLinkIsNew(rssChannelLinksCache, link);
								link.isNew = isLinkNew;

								if (isLinkNew) {
									newArticlesNumber++;
								}

							});

							rssChannel.newArticlesNumber = newArticlesNumber;

						} else {
							newArticlesNumber = links.length;
							links.forEach((link) => {
								link.isNew = true;
							});
						}

						RSSChannelsUtil.saveRSSChannelLinks(links, rssChannel.id);
						rssChannel.newArticlesNumber = newArticlesNumber;

						dfd.resolve({
							links
						});

					} catch (e) {
						RSSChannelsUtil.rejectSyncRSSChannel(rssChannel, dfd);
					}

				},
				error: (data) => {
					RSSChannelsUtil.rejectSyncRSSChannel(rssChannel, dfd);
				}
			});

		}

		return dfd.promise();
	}

};

const OnClickFunctions = {

	backToHomeView: function() {
		UI_Util.printRSSChannelsList(rssChannelsList);
		UI_Util.cardsTransition($(this).data('parent-container-id'), '#rss-channels-list-container');
	},

	showAddRSSChannelView: () => {
		UI_Util.cardsTransition('#rss-channels-list-container', '#add-rss-channel-container');
	},

	syncAllRSSChannels: () => {

		const defereds = rssChannelsList.map((rssChannel) => {
			return syncRSSChannel(rssChannel);
		});

		$.when.apply($, defereds).then(() => {
			UI_Util.printRSSChannelsList(rssChannelsList);
		}, () => {
			UI_Util.printRSSChannelsList(rssChannelsList);
		});
	},

	addRSSChannel: (event) => {

		event.preventDefault();

		const url = $('#input-url').val().trim();
		const title = $('#input-title').val().trim();

		if (url && title) {

			$.when(BookmarksUtil.createBookmark({
				parentId: rssChannelsFolderId,
				title,
				url
			})).then((newBookmark) => {
				newBookmark.newArticlesNumber = 0;
				rssChannelsList.push(newBookmark);
				UI_Util.cardsTransition('#add-rss-channel-container', '#rss-channels-list-container');
				UI_Util.printRSSChannelsList(rssChannelsList);
				$('#input-url, #input-title').val('');
			});

		}
	},

	removeRSSChannel: () => {
		BookmarksUtil.removeBookmark(rssChannelSelected)
			.then(() => {
				UI_Util.cardsTransition('#rss-channel-details-container', '#rss-channels-list-container');
				UI_Util.printRSSChannelsList(rssChannelsList);
			});
	},

	syncRSSChannel: () => {

		jQuery('#rss-channel-links-ul').hide();
		jQuery('#error-message').hide();

		$.when(RSSChannelsUtil.syncRSSChannel(rssChannelSelected, true))
			.then((result) => {
				UI_Util.printRSSChannelLinks(result.links);
			}, (error) => {
				jQuery('#error-message').text('RSS Channel content cannot be loaded.').show();
			});
	},

	markAsReadAllRSSChannelLinks: () => {

		const links = RSSChannelsUtil.getRSSChannelLinks(rssChannelSelected.id);

		if (links) {

			links.forEach((link) => {
				link.isNew = false;
			});

			RSSChannelsUtil.saveRSSChannelLinks(links, rssChannelSelected.id);
			rssChannelSelected.newArticlesNumber = 0;
			UI_Util.printRSSChannelLinks(links);
		}

	},

	selectRSSChannelListItem: function() {

		const item = $(this);
		rssChannelSelected = RSSChannelsUtil.getRSSChannelById(rssChannelsList, item.data('rss-channel-id'));

		const callback = () => {
			jQuery('#rss-channel-links-ul').scrollTop(0).hide();
			jQuery('#error-message').hide();
			$.when(RSSChannelsUtil.syncRSSChannel(rssChannelSelected))
				.then((result) => {
					UI_Util.printRSSChannelLinks(result.links);
				}, (error) => {
					jQuery('#error-message').text('RSS Channel content cannot be loaded.').show();
				});
		};

		UI_Util.cardsTransition('#rss-channels-list-container', '#rss-channel-details-container', callback);
		$('#rss-channel-title').text(rssChannelSelected.title);
	},

	selectRSSChannelLink: function() {

		const link = $(this);

		chrome.tabs.create({
			url: link.data('rss-channel-link-url'),
			active: false
		});

		link.find('.badge').hide();

		if (rssChannelSelected.newArticlesNumber > 0) {
			rssChannelSelected.newArticlesNumber = rssChannelSelected.newArticlesNumber - 1;
		}

		const links = RSSChannelsUtil.getRSSChannelLinks(rssChannelSelected.id);
		links[parseInt(link.data('rss-channel-link-index'))].isNew = false;
		RSSChannelsUtil.saveRSSChannelLinks(links, rssChannelSelected.id);
	},

	attachOnClickEventToRSSChannelItem: () => {
		$('.rss-channel-list-item').on('click', OnClickFunctions.selectRSSChannelListItem);
	},

	attachOnClickEventToRSSChannelLinkItem: () => {
		$('.rss-channel-link').on('click', OnClickFunctions.selectRSSChannelLink);
	}

};

$(document).ready(() => {

	RSSChannelsUtil.fetchRSSChannelsList();

	// General
	$('.back-to-home-btn').on('click', OnClickFunctions.backToHomeView);

	// RSS Channels List View
	$('#show-add-rss-channel-view-btn').on('click', OnClickFunctions.showAddRSSChannelView);
	$('#update-all-rss-channels-btn').on('click', OnClickFunctions.syncAllRSSChannels);

	// Add RSS Channels View
	$('#add-rss-channel-form').on('submit', OnClickFunctions.addRSSChannel);

	// RSS Channel Details View
	$('#remove-rss-channel-btn').on('click', OnClickFunctions.removeRSSChannel);
	$('#sync-rss-channel-btn').on('click', OnClickFunctions.syncRSSChannel);
	$('#check-all-rss-channel-btn').on('click', OnClickFunctions.markAsReadAllRSSChannelLinks);

});