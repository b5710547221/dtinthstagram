
var http = require('apollo:http');
var ACCESS_TOKEN = localStorage.instagramAccessToken;
var CLIENT_ID = '99fd011a2cad4223a3b2bc48b4d2ab17';
if (location.href.match(/:8000/i)) {
	CLIENT_ID = 'd2f6987697f04bf9a99d0d98b7efa860';
}
var API_BASE = 'https://api.instagram.com/v1';
var CORS_BASE = 'https://corstagram.appspot.com/v1';
//CORS_BASE = 'http://localhost:8080/v1';//!!!!!!!!!!!!
var me;

function req(url) {
	return http.jsonp(url);
}

function post(url, body) {
	return http.json(url, { method: "POST", body: body });
}
function del(url) {
	return http.json(url, { method: "DELETE" });
}
function up(res) {
	if (res.meta) return new Error(res.meta.code + ' ' + res.meta.error_type + ' ' + res.meta.error_message);
	return new Error('cannot load: ' + res);
}

function api_url(endpoint) {
	return endpoint + (~endpoint.indexOf('?') ? '&' : '?') + 'access_token=' + ACCESS_TOKEN;
}

function api(endpoint) {
	return req(api_url(endpoint));
}

function main() {
	if (!ACCESS_TOKEN) {
		return authenticationNeeded();
	}
	try {
		var res = api(API_BASE + '/users/self').data;
		if (res == null) {
			throw new Error('unauthorized');
		}
		me = UserFactory.fromJSON(res);
	} catch (e) {
		return authenticationNeeded();
	}
	var feed = new UserFeed('self');
	//new HomeFeed();
	new FeedView(feed).renderTo('#main');
	feed.loadNext();
	setInterval(function() {
		feed.refresh();
	}, 60000);
}

function EventEmitter() {
	var that = {};
	var list = {};
	that.on = function(name, fn) {
		var c = list[name] || (list[name] = []);
		list[name].push(fn);
	};
	that.emit = function(name) {
		var a = _.toArray(arguments).slice(1);
		if (list[name]) {
			for (var i = 0; i < list[name].length; i ++) {
				spawn list[name][i].apply(that, a);
			}
		}
	};
	return that;
}

var unimplemented = function() { throw new Error('Unimplemented!'); };

function View(view) {
	var that = {};
	that.view = view;
	that.list = {};
	var rendered = false;
	that.render = function() {
	};
	that.renderTo = function(el) {
		if (!rendered) {
			that.render();
			rendered = true;
		}
		that.view.el.appendTo(el);
	};
	return that;
}

function FeedLoader(baseURL) {
	var that = {};
	var minId = null;
	var maxId = null;
	var url = baseURL;
	function handleResponse(res) {
		if (res.data) {
			if (res.data[0]) {
				minId = res.data[0].id;
			}
			return res.data;
		}
	}
	that.hasNext = function() {
		return url != null;
	};
	that.loadNext = function() {
		var res = req(url);
		if (res.pagination) {
			maxId = res.pagination.next_max_id;
			url = baseURL + (~baseURL.indexOf('?') ? '&' : '') + 'max_id=' + maxId;
		} else {
			maxId = null;
			url = null;
		}
		return handleResponse(res);
	};
	that.refresh = function() {
		var res = req(baseURL + (~baseURL.indexOf('?') ? '&' : ''));
		return handleResponse(res);
	};
	return that;
}

function Comment(json) {
	var that = {};
	that.created = new Date(json.created_time * 1000);
	that.text = json.text;
	that.from = UserFactory.fromJSON(json.from);
	that.id = json.id;
	return that;
}

function Collection() {
	var that = new EventEmitter();
	that.list = [];
	that.prepend = function() {
		if (arguments.length == 0) return;
		that.list.unshift.apply(that.list, arguments);
		that.emit('prepend', _.toArray(arguments));
		that.emit('change');
	};
	that.append = function() {
		if (arguments.length == 0) return;
		that.list.push.apply(that.list, arguments);
		that.emit('append', _.toArray(arguments));
		that.emit('change');
	};
	that.get = function(i) { return that.list[i]; };
	that.set = function(i, v) { that.list[i] = v; };
	that.size = function() { return that.list.length; };
	return that;
}

function ResponseCollection() {
	var that = new Collection();
	var map = {};
	that.count = 0;
	that.merge = function(json, mapfn) {
		if (json == null) return;
		that.count = json.count;
		var addition = [];
		var newMap = {};
		for (var i = 0; i < json.data.length; i ++) {
			var c = mapfn(json.data[i]);
			if (map[c.id] == null) {
				map[c.id] = true;
				addition.push(c);
			}
			newMap[c.id] = true;
		}
		var toRemove = [];
		for (var i in map) {
			if (map.hasOwnProperty(i) && !newMap[i]) {
				delete map[i];
				for (var j = 0; j < that.list.length; j ++) {
					if (that.list[j].id == i) {
						toRemove.push(that.list[j]);
						that.list.splice(j, 1);
						break;
					}
				}
			}
		}
		if (toRemove.length > 0) {
			that.emit('remove', toRemove);
		}
		that.append.apply(that.append, addition);
		if (toRemove.length > 0 && addition.length == 0) {
			that.emit('change');
		}
	};
	return that;
}

function Media(id) {
	var that = new EventEmitter();
	that.id = id;
	that.likes = new ResponseCollection();
	that.comments = new ResponseCollection();
	that.load = function(json) {
		var user = UserFactory.fromJSON(json.user);
		that.user = user;
		that.likes.merge(json.likes, function(c) {
			return UserFactory.fromJSON(c);
		});
		that.location = json.location;
		var comments = { count: 0, data: [] };
		if (json.comments != null) {
			comments.count = json.comments.count;
			comments.data = json.comments.data.slice();
		}
		if (json.caption) {
			comments.data.unshift(json.caption);
		}
		that.comments.merge(comments, function(c) {
			return new Comment(c);
		});
		that.created = new Date(json.created_time * 1000);
		that.link    = json.link;
		that.images  = json.images;

		that.setLiked(!!json.user_has_liked);
		return that;
	};
	that.setLiked = function(liked) {
		if (liked != that.liked) {
			that.liked = liked;
			that.emit('likeChanged');
		}
	};
	that.toggleLike = function() {
		try {
			that.emit('startLike');
			var target = !that.liked;
			var res = post(api_url(CORS_BASE + '/media/' + that.id + '/likes/' + (target ? '' : '?method=DELETE')));
			if (res.meta && res.meta.code == 200) {
				that.setLiked(target);
			}
		} finally {
			that.emit('finishLike');
		}
	};
	that.comment = function(text) {
		var res = post(api_url(CORS_BASE + '/media/' + that.id + '/comments'), 'text=' + encodeURIComponent(text));
		if (res.meta && res.meta.code == 200) {
			that.comments.append(new Comment(res.data));
		} else {
			throw up(res);
		}
	};
	that.reload = function() {
		try {
			that.emit('startReload');
			var media = api(API_BASE + '/media/' + that.id + '?now=' + new Date().getTime());
			that.load(media.data);
		} finally {
			that.emit('finishReload');
		}
	};
	return that;
}

function User(id) {
	var that = {};
	var data;
	that.id = id;
	that.load = function(json) {
		data = json;
		that.username = data.username;
		that.fullName = data.full_name;
		that.profilePicture = data.profile_picture;
		return that;
	};
	return that;
}

function Factory() {
	var that = {};
	that.map = {};
	that.get = function(id) {
		var key = 'id_' + id;
		return that.map[key] || (that.map[key] = that.create(id));
	};
	that.fromJSON = function(json) {
		return that.get(json.id).load(json);
	};
	that.create = unimplemented;
	return that;
}

var MediaFactory = new Factory();
MediaFactory.create = function(id) {
	return new Media(id);
};

var UserFactory = new Factory();
UserFactory.create = function(id) {
	return new User(id);
};

function Feed() {
	var that = new Collection();
	var map = {};
	function getNewMedia(list) {
		var addition = [];
		for (var i = 0; i < list.length; i ++) {
			var media = MediaFactory.fromJSON(list[i]);
			if (map[media.id] == null) {
				map[media.id] = media;
				addition.push(media);
			}
		}
		return addition;
	}
	that.loadNext = function() {
		try {
			that.emit('startLoading');
			var list = that.loader.loadNext();
			var addition = getNewMedia(list);
			if (addition.length > 0) {
				that.append.apply(that.append, addition);
			}
		} finally {
			that.emit('finishLoading');
		}
	};
	that.hasNext = function() {
		return that.loader.hasNext();
	};
	that.refresh = function() {
		try {
			that.emit('startRefreshing');
			var list = that.loader.refresh();
			var addition = getNewMedia(list);
			if (addition.length > 0) {
				that.prepend.apply(that.prepend, addition);
			}
		} finally {
			that.emit('finishRefreshing');
		}
	};
	return that;
}

function HomeFeed() {
	var that = new Feed();
	that.loader = new FeedLoader(api_url(API_BASE + '/users/self/feed'));
	that.title = '/users/self/feed';
	return that;
}

function UserFeed(user) {
	var that = new Feed();
	that.loader = new FeedLoader(api_url(API_BASE + '/users/' + user + '/media/recent'));
	that.title = '/users/' + user + '/media/recent';
	return that;
}

function animation(duration, callback) {
	var start = new Date().getTime();
	do {
		var now = new Date().getTime();
		var value = Math.min(1, (now - start) / duration);
		callback(value);
		waitfor() {
			if (typeof mozRequestAnimationFrame != 'undefined') {
				mozRequestAnimationFrame(resume);
			} else {
				hold(1);
				resume();
			}
		}
	} while (now - start < duration);
}

function FeedView(feed) {

	var that = new View($('#feed').tpl());
	
	that.feed = feed;
	that.view.el.iconify();
	that.view.title.text(feed.title);
	that.view.loadMore.click(that.feed.loadNext).hide();
	
	that.feed.on('startLoading', function() {
		that.view.loading.show();
		that.view.loadMore.hide();
	});
	that.feed.on('finishLoading', function() {
		that.view.loading.hide();
		if (that.feed.hasNext()) {
			that.view.loadMore.show();
		}
	});

	var refreshing = false;
	that.feed.on('startRefreshing', function() {
		refreshing = true;
		that.view.refresh.addClass('dim');
	});
	that.feed.on('finishRefreshing', function() {
		refreshing = false;
		that.view.refresh.removeClass('dim');
	});
	that.view.refresh.click(function() {
		if (!refreshing) {
			that.feed.refresh();
		}
	});

	function showList(list) {
		var el = $('<div class="changeset"></div>');
		for (var i = 0; i < list.length; i ++) {
			var media = list[i];
			var view = new MediaView(media);
			view.renderTo(el);
		}
		return el;
	}

	that.view.contents.append(showList(that.feed.list));
	that.feed.on('append', function(nextData) {
		animation(200, function(x) {
			that.view.footer.css('opacity', (1 - x));
		});
		that.view.footer.css('opacity', 1);
		var changeset = showList(nextData);
		that.view.contents.append(changeset);
		animation(600, function(x) {
			var top = Math.round(window.innerHeight * Math.pow(1 - x, 2));
			changeset.css('top', top + 'px');
		});
	});
	that.feed.on('prepend', function(newData) {
		var el = that.view.contents.find('.picture').eq(0);
		var changeset = showList(newData);
		function setOpacity(o) {
			that.view.head[0].style.opacity = o;
			document.getElementById('head').style.opacity = o;
		}
		animation(200, function(x) {
			var opacity = 1 - x;
			setOpacity(opacity);
		});
		var oldTop = el.offset().top;
		that.view.contents.prepend(changeset);
		var newTop = el.offset().top;
		window.scrollBy(0, newTop - oldTop);
		setOpacity(1);
		animation(600, function(x) {
			var top = Math.round(-window.innerHeight * Math.pow(1 - x, 2));
			changeset[0].style.top = top + 'px';
		});
	});

	return that;

}

function CollectionView(collection) {
	var that = new View($('#collection').tpl());
	/*
	function dom(list) {
		var el = $('<div class="collectionview-changeset"></div>');
		for (var i = 0; i < list.length; i ++) {
			that.createView(list[i]).renderTo(el);
		}
		return el;
	}
	that.render = function() {
		that.view.el.append(dom(collection.list));
		collection.on('append', function(list) {
			that.view.el.append(dom(list));
		});
		collection.on('prepend', function(list) {
			that.view.el.prepend(dom(list));
		});
	};
	*/
	var display = [];
	var animationEnabled = false;
	function update() {
		var all = [];
		var prevMap = {};
		var nextMap = {};
		var next = [];
		for (var i = 0; i < display.length; i ++) {
			var c = display[i];
			prevMap[c.id] = c;
			all.push(c);
		}
		for (var i = 0; i < collection.size(); i ++) {
			var c = {
				el: null,
				view: null,
				item: collection.get(i),
				id: collection.get(i).id
			};
			if (!prevMap[c.id]) {
				all.push(c);
				next.push(c);
			} else {
				next.push(prevMap[c.id]);
			}
			nextMap[c.id] = true;
		}
		var comparator = function(a, b) {
			return a.item.created.getTime() - b.item.created.getTime();
		};
		all.sort(comparator);
		next.sort(comparator);
		display = next;
		for (var i = 0; i < all.length; i ++) {
			var c = all[i];
			if (!nextMap[c.id]) {
				that.view.el.append(c.el);
				if (animationEnabled) {
					spawn slideUp(c.el[0]);
				} else {
					c.el.remove();
				}
			} else if (!prevMap[c.id]) {
				c.el = $('<div class="collectionview-item"></div>');
				c.view = that.createView(c.item);
				c.view.renderTo(c.el);
				that.view.el.append(c.el);
				if (animationEnabled) {
					spawn slideDown(c.el[0]);
				}
			} else {
				that.view.el.append(c.el);
			}
		}
	}
	function slide(element, inner, formula) {
		animation(300, function(x) {
			var height = formula(x) * inner.offsetHeight;
			element.style.height = height + 'px';
		});
	}
	function slideDown(element) {
		var inner = element.firstChild;
		element.style.overflow = 'hidden';
		element.style.height = '0';
		slide(element, inner, function(x) { return (1 - Math.pow(1 - x, 2)) });
		element.style.height = '';
		element.style.overflow = '';
	}
	function slideUp(element) {
		var inner = element.firstChild;
		element.style.overflow = 'hidden';
		slide(element, inner, function(x) { return Math.pow(1 - x, 2); });
		element.parentNode && element.parentNode.removeChild(element);
	}
	that.render = function() {
		update();
		animationEnabled = true;
		collection.on('change', function() {
			update();
		});
	};
	return that;
}

function AddCommentView(feed) {

	var that = new View($('#add-comment').tpl());
	that.view.pointer.each(function() {
		var paper = Raphael(this, 12, 12);
		paper.path('M 14 -1 M 10.5 -1 l 0 2 l -5 5 l 5 5 l 0 2 L 14 13')
			.attr({ 'stroke': '#454443', 'fill': '#090807' });
	});
	that.view.user.html(user_html(me));
	that.view.el.hide();

	var showing = false;
	that.hide = function() {
		if (!showing) return;
		showing = false;
		that.view.el.hide('fast');
	};
	that.show = function() {
		if (showing) return;
		showing = true;
		that.view.el.show('fast');
		that.view.textarea[0].focus();
	};
	that.toggle = function() {
		if (showing) {
			that.hide();
		} else {
			that.show();
		}
	};
	that.events = new EventEmitter();

	that.view.textarea.keydown(function(e) {
		if (e.keyCode == 13) {
			that.events.emit('enter');
			return false;
		}
	});
	that.getText = function() {
		return that.view.textarea[0].value;
	};
	that.disable = function() {
		that.view.textarea[0].disabled = true;
		that.view.el.addClass('dim');
	};
	that.enable = function() {
		that.view.textarea[0].disabled = false;
		that.view.el.removeClass('dim');
	};
	return that;

}

function MediaView(media) {

	var that = new View($('#picture').tpl());
	var view = that.view;


	// user

	view.user.html(user_html(media.user));
	view.picture.append('<img src="' + media.user.profilePicture + '" alt="">');
	view.date.text(formatDate(media.created));


	// image

	function appendImage(image) {
		var el = new Image();
		el.className = 'hide';
		el.onload = function() {
			el.className = 'show';
		};
		setTimeout(function() {
			el.className = 'show';
		}, 1000);
		el.src = image.url;
		$(el).appendTo(view.image);
		return el;
	}

	var lowResImage = appendImage(media.images.low_resolution);
	var highResAppended = false;

	view.image.click(function() {
		view.el.toggleClass('zoomed');
		if (!highResAppended) {
			highResAppended = true;
			appendImage(media.images.standard_resolution);
			lowResImage.className = 'dim';
		}
	});


	// geotag
	
	if (media.location) {
		var place = media.location.latitude + ', ' + media.location.longitude;
		var placeName = place;
		if (media.location.name) placeName = media.location.name;
		view.geo.html('<a href="http://maps.google.com/?q=' + encodeURIComponent(place) + '">' + placeName + '</a>');
	} else {
		view.geoContainer.hide();
	}


	// comments

	var commentsView = new CollectionView(media.comments);
	commentsView.createView = function(comment) {
		var commentView = new View($('#comment').tpl());
		commentView.view.user.html(user_html(comment.from));
		commentView.view.text.text(comment.text);
		commentView.view.date.html(formatDate(comment.created));
		return commentView;
	};
	function updateCommentCount() {
		view.commentCount.text(media.comments.count);
	}
	commentsView.renderTo(view.rows);
	updateCommentCount();
	media.comments.on('change', updateCommentCount);
	var addCommentView = null;
	view.commentIcon.click(function() {
		if (addCommentView == null) {
			addCommentView = new AddCommentView();
			addCommentView.events.on('enter', function() {
				var text = addCommentView.getText();
				try {
					addCommentView.disable();
					media.comment(text);
					addCommentView.hide();
					media.reload();
				} catch (e) {
					alert('cannot post comment:\n' + e.toString());
				} finally {
					addCommentView.enable();
				}
			});
			addCommentView.renderTo(view.addComment);
		}
		addCommentView.toggle();
	});


	// likes

	function showLikes() {
		var html = '';
		var count = 0;
		for (var i = 0; i < media.likes.size(); i ++) {
			html += (i == 0 ? '' : ', ') + user_html(media.likes.get(i));
			count ++;
		}
		if (media.likes.size() < media.likes.count) {
			html += ', +' + (media.likes.count - media.likes.size()) + ' others';
		}
		view.likes.html(html);
		view.likeCount.text(media.likes.count);
	}
	showLikes();
	view.el.iconify();
	media.likes.on('change', showLikes);

	function updateLike() {
		view.likeIcon.data('icon').attr('fill', media.liked ? '#ffff99' : '#8b8685');
	}
	media.on('likeChanged', updateLike);
	updateLike();

	media.on('startLike', function() { view.likeIcon.addClass('dim'); });
	media.on('finishLike', function() { view.likeIcon.removeClass('dim'); });
	media.on('startReload', function() { view.right.addClass('dim'); });
	media.on('finishReload', function() { view.right.removeClass('dim'); });
	view.likeIcon.click(function() {
		media.toggleLike();
		media.reload();
	});

	return that;

}


function formatDate(cdate) {
	var fdate = '';
	var now = new Date();
	if (cdate.getDate() != now.getDate() || cdate.getMonth() != now.getMonth() || cdate.getFullYear() != now.getFullYear()) {
		fdate = (cdate.getFullYear() != now.getFullYear() ? cdate.getFullYear() + '-' : '') + twoDigits(cdate.getMonth() + 1) + '-' + twoDigits(cdate.getDate()) + ' ';
	}
	function twoDigits(x) {
		return (x < 10 ? '0' : '') + x;
	}
	return fdate + cdate.getHours() + ':' + twoDigits(cdate.getMinutes()) + ':' + twoDigits(cdate.getSeconds());
}

function user_html(user) {
	return '<span class="username">' + user.username + '</span>';
}

function authenticationNeeded() {
	var callbackURL = location.protocol + '//' + location.host + location.pathname.replace(/[^\/]*$/, '') + 'callback.html';
	var redirectURL = 'https://instagram.com/oauth/authorize/?client_id=' + CLIENT_ID + '&redirect_uri=' + encodeURIComponent(callbackURL) + '&response_type=token&scope=likes+comments+relationships';
	$('#auth-needed').tpl().el.appendTo('#main');
	location.replace(redirectURL);
}

$(main);
