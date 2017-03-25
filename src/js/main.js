const OTHER_BOOKMARKS_FOLDER_ID = '2';
const RSS_CHANNELS_FOLDER_NAME = 'RSS Reader - Channels';

let rssChannelSelected = {};
let rssChannelsFolderId = '';
let rssChannelsList = [];

function createBookmark(bookmark) {

	const dfd = jQuery.Deferred();

	chrome.bookmarks.create(bookmark, (newBookmark) => {
		dfd.resolve(newBookmark);
	});

	return dfd.promise();
}

function removeBookmark(bookmark) {

	const dfd = jQuery.Deferred();

	chrome.bookmarks.remove(bookmark.id, () => {

		rssChannelsList = rssChannelsList.filter((item) => {
			return item.id !== bookmark.id;
		});

		window.localStorage.removeItem('rss_channel_' + bookmark.id);

		dfd.resolve('finished');
	});

	return dfd.promise();
}

function sortRSSChannelsByName(rssChannelsList) {
	rssChannelsList.sort((a, b) => {
		return a.title > b.title;
	});
}

function getRSSChannelById(rssChannelId, rssChannelsList) {

	const results = rssChannelsList.filter((item) => {
		return item.id == rssChannelId;
	});

	if (results.length === 1) {
		return results[0];
	}

	return null;
}

function getRSSChannelListItemTemplate(id, title, newArticlesNumber) {

	const displayNewArticlesNumber = newArticlesNumber === 0 ? "display:none" : "display:inline-block";

	return `<li class="collection-item rss-channel-list-item" data-rss-channel-id="${id}">
					${title}
					<i class="material-icons right grey-text text-lighten-3">send</i>
					<span class="new badge right red darken-3" style="${displayNewArticlesNumber}">${newArticlesNumber}</span>
				</li>`;
}

function getRSSChannelLinkTemplate(index, link) {

	const displayIsNew = !link.isNew ? "display:none" : "display:block";

	return `<li data-rss-channel-link-url="${link.url}" target="_blank" class="collection-item rss-channel-link" data-rss-channel-link-index="${index}">
					<p class="rss-channel-link-title">${link.title}</p>
					<p class="rss-channel-link-date">${link.pubDate}</p>
					<span class="new badge right red darken-3 rss-channel-link-is-new" style="${displayIsNew}"></span>
				</li>`;
}

function printRSSChannels(rssChannelsList) {

	sortRSSChannelsByName(rssChannelsList);

	let html = '';
	rssChannelsList.forEach((rssChannel) => {
		html += getRSSChannelListItemTemplate(rssChannel.id, rssChannel.title, rssChannel.newArticlesNumber);
	});

	jQuery('#rss-channels-list-ul').html(html);
	attachOnClickEventToRSSChannelsItem();
}

function printRSSChannelsLinks(items) {

	let html = '';
	items.forEach((link, index) => {
		html += getRSSChannelLinkTemplate(index, link);
	});

	jQuery('#rss-channel-links-ul').html(html).show();
	attachOnClickEventToRSSChannelLinks();
}

function getRSSChannelsList() {

	chrome.bookmarks.getChildren(OTHER_BOOKMARKS_FOLDER_ID, (results) => {

		const filterResults = results.filter((item) => {
			return item.title === RSS_CHANNELS_FOLDER_NAME;
		});

		if (filterResults.length === 0) {

			$.when(createBookmark({
					parentId: OTHER_BOOKMARKS_FOLDER_ID,
					title: RSS_CHANNELS_FOLDER_NAME
				}))
				.then((newBookmark) => {
					rssChannelsFolderId = newBookmark.id;
				});

		} else {

			rssChannelsFolderId = filterResults[0].id;

			chrome.bookmarks.getChildren(rssChannelsFolderId, (results) => {

				rssChannelsList = [].concat(results);

				rssChannelsList.forEach((item) => {

					let newArticlesNumber = 0;
					const links = getRSSChannelLinks(item.id);

					if (links) {
						links.forEach((link) => {
							if (link.isNew === true) {
								newArticlesNumber++;
							}
						});
					}

					item.newArticlesNumber = newArticlesNumber;
				});

				printRSSChannels(rssChannelsList);
			});

		}

	});

}

function checkIfLinkIsNew(link, linksList) {

	for (let i = 0, length = linksList.length; i < length; i++) {
		if (link.title == linksList[i].title) {
			return true;
		}
	}

	return false;
}

function getRSSChannelLinks(rssChannelId) {
	try {
		return JSON.parse(window.localStorage.getItem('rss_channel_' + rssChannelId)).links;
	} catch (e) {
		return null;
	}
}

function saveRSSChannelLinks(links, rssChannelId) {
	window.localStorage.setItem('rss_channel_' + rssChannelId, JSON.stringify({
		links
	}));
}

function rejectSyncRSSChannel(rssChannel, defered) {
	rssChannel.newArticlesNumber = 0;
	window.localStorage.removeItem('rss_channel_' + rssChannel.id);
	return defered.reject(rssChannel);
}

function syncRSSChannel(rssChannel, forceCache) {

	const dfd = jQuery.Deferred();
	const rssChannelItemsCache = getRSSChannelLinks(rssChannel.id);
	let newArticlesNumber = rssChannel.newArticlesNumber;

	if (rssChannelItemsCache && !forceCache) {

		dfd.resolve({
			links: rssChannelItemsCache
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
						return rejectSyncRSSChannel(rssChannel, dfd);
					}

					const rssChannelItemsCache = getRSSChannelLinks(rssChannel.id);

					if (rssChannelItemsCache) {

						links.forEach((link) => {

							const isLinkNew = checkIfLinkIsNew(link, rssChannelItemsCache);
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

					saveRSSChannelLinks(links, rssChannel.id);
					rssChannel.newArticlesNumber = newArticlesNumber;

					dfd.resolve({
						links
					});

				} catch (e) {
					rejectSyncRSSChannel(rssChannel, dfd);
				}

			},
			error: (data) => {
				rejectSyncRSSChannel(rssChannel, dfd);
			}
		});

	}

	return dfd.promise();
}

function cardsTransition(containerToHide, containerToShow, callback) {
	$(containerToHide).fadeOut('slow', () => {
		$(containerToShow).fadeIn(1000);
		if (callback) {
			callback();
		}
	});
}

function attachOnClickEventToRSSChannelsItem() {

	$('.rss-channel-list-item').on('click', function() {

		const item = $(this);
		rssChannelSelected = getRSSChannelById(item.data('rss-channel-id'), rssChannelsList);

		const callback = () => {
			jQuery('#rss-channel-links-ul').hide();
			jQuery('#error-message').hide();
			$.when(syncRSSChannel(rssChannelSelected))
				.then((result) => {
					printRSSChannelsLinks(result.links);
				}, (error) => {
					jQuery('#error-message').text('RSS Channel content cannot be loaded.').show();
				});
		};

		cardsTransition('#rss-channels-list-container', '#rss-channel-details-container', callback);
		$('#rss-channel-title').text(rssChannelSelected.title);
	});

}

function attachOnClickEventToRSSChannelLinks() {

	$('.rss-channel-link').on('click', function() {

		const link = $(this);

		chrome.tabs.create({
			url: link.data('rss-channel-link-url'),
			active: false
		});

		link.find('.badge').hide();

		if (rssChannelSelected.newArticlesNumber > 0) {
			rssChannelSelected.newArticlesNumber = rssChannelSelected.newArticlesNumber - 1;
		}

		const links = getRSSChannelLinks(rssChannelSelected.id);
		links[parseInt(link.data('rss-channel-link-index'))].isNew = false;
		saveRSSChannelLinks(links, rssChannelSelected.id);
	});

}

$(document).ready(() => {

	getRSSChannelsList();

	$('.back-to-home-btn').on('click', function() {
		printRSSChannels(rssChannelsList);
		cardsTransition($(this).data('parent-container-id'), '#rss-channels-list-container');
	});

	$('#show-add-rss-channel-view-btn').on('click', () => {
		cardsTransition('#rss-channels-list-container', '#add-rss-channel-container');
	});

	$('#update-all-rss-channels-btn').on('click', () => {

		const defereds = rssChannelsList.map((rssChannel) => {
			return syncRSSChannel(rssChannel);
		});

		$.when.apply($, defereds).then(() => {
			printRSSChannels(rssChannelsList);
		}, () => {
			printRSSChannels(rssChannelsList);
		});

	});

	$('#add-rss-channel-form').on('submit', (event) => {

		event.preventDefault();

		const url = $('#input-url').val().trim();
		const title = $('#input-title').val().trim();

		if (url && title) {

			$.when(createBookmark({
				parentId: rssChannelsFolderId,
				title,
				url
			})).then((newBookmark) => {
				newBookmark.newArticlesNumber = 0;
				rssChannelsList.push(newBookmark);
				cardsTransition('#add-rss-channel-container', '#rss-channels-list-container');
				printRSSChannels(rssChannelsList);
				$('#input-url, #input-title').val('');
			});

		}

	});

	$('#remove-rss-channel-btn').on('click', () => {

		removeBookmark(rssChannelSelected)
			.then(() => {
				cardsTransition('#rss-channel-details-container', '#rss-channels-list-container');
				printRSSChannels(rssChannelsList);
			});

	});

	$('#sync-rss-channel-btn').on('click', () => {

		jQuery('#rss-channel-links-ul').hide();
		jQuery('#error-message').hide();

		$.when(syncRSSChannel(rssChannelSelected, true))
			.then((result) => {
				printRSSChannelsLinks(result.links);
			}, (error) => {
				jQuery('#error-message').text('RSS Channel content cannot be loaded.').show();
			});

	});

});