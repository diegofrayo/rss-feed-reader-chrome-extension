var BookmarksUtil = {
	OTHER_BOOKMARKS_FOLDER_ID: '2',
	RSS_CHANNELS_FOLDER_NAME: 'RSS Reader - Channels',
	createBookmark: function() {

	},
	deleteBookmark: function() {

	},
	getFolder: function(folderId) {
		chrome.bookmarks.getChildren(folderId, function(results) {});
	}
};

function getXMLFile(url) {

	$.ajax(url, {
		accepts: {
			xml: 'application/rss+xml'
		},
		dataType: 'xml',
		success: function(data) {
			$(data).find('item').each(function() {
				var item = $(this);
				item.find('title').text();
				item.find('link').text();
				item.find('description').text();
			});
		},
		error: function(data) {
			console.log(data);
		}
	});

}

$(document).ready(function() {
	BookmarksUtil.getFolder(BookmarksUtil.OTHER_BOOKMARKS_FOLDER_ID);
	Materialize.updateTextFields();
});