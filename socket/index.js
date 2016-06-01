var log = require("lib/log")(module);
var async = require("async");
var cookie = require("cookie");
var config = require('config');
var cookieParser = require('cookie-parser');
var sessionStore = require("lib/sessionStore");
var HttpError = require("error").HttpError;
var User = require("models/user").User;
var clients = [];


function loadSession(sid, callback) {
    // sessionStore callback is not quite async-style!
    sessionStore.load(sid, function(err, session) {
        if (arguments.length == 0) {
            // no arguments => no session
            return callback(null, null);
        } else {
            return callback(null, session);
        }
    });
}

function loadUser(session, callback) {
    if (!session.user) {
        log.debug("Session %s is anonymous", session.id);
        return callback(null, null);
    }

    log.debug("retrieving user ", session.user);

    User.findById(session.user, function(err, user) {
        if (err) return callback(err);

        if (!user) {
            return callback(null, null);
        }
        log.debug("user findbyId result: " + user);
        callback(null, user);
    });
}




module.exports = function(server) {
    var io = require('socket.io').listen(server);
    //io.set('origins', 'localhost:3000');

    io.use(function(socket, next) {
        log.info("handshake: ", socket.handshake);

        async.waterfall([
            function(callback) {

                var cookies = cookie.parse(socket.request.headers.cookie || "");
                var sidCookie = cookies[config.get("session:key")];
                var sid = cookieParser.signedCookie(sidCookie, config.get("session:secret"));
                log.info("sid: " + sid);

                socket.handshake.cookie = cookies;
                loadSession(sid, callback)
            },
            function (session, callback) {
                if (!session) {
                    callback (new HttpError(401, "No session!"))
                }
                socket.handshake.session = session;
                loadUser(session, callback);
            },
            function(user, callback) {
                if (!user) {
                    callback(new HttpError(403, "Anonymous session may not connect"));
                }

                socket.handshake.user = user;
                callback(null);
            }
        ], function (err) {
            if (!err) {
                return next(null, true);
            }

            if (err instanceof HttpError) {
                return next(null, false);
            }

            next(err);
        });
    });

    io.on('sessreload', function(sid) {

        clients.forEach(function(client) {
            if (client.handshake.session.id != sid) return;

            loadSession(sid, function(err, session) {
                if (err) {
                    client.emit("error", "server error");
                    client.disconnect();
                    return;
                }

                if (!session) {
                    client.emit("logout");
                    client.disconnect();
                    return;
                }

                client.handshake.session = session;
            });

        });

    });

    io.on('connection', function(socket, next) {
    	clients.push(socket);

        var username = socket.handshake.user.get('username');
        socket.broadcast.emit('join', username);
        log.debug(username);

        socket.on('message', function(text, cb) {
            socket.broadcast.emit('message', username, text);
            cb && cb();
        });

        socket.on('disconnect', function() {
            socket.broadcast.emit('leave', username);
        });
    });
    return io;
};