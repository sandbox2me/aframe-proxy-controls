/**
 * Client controls via WebRTC datastream, for A-Frame VR.
 *
 * @namespace proxy-controls
 * @param {string} url - URL of remote WebRTC connection broker.
 * @param {key} key - API key for PeerJS service.
 * @param {id} id - ID for local client.
 * @param {number} [easing=20] - How fast the movement decelerates. If you hold the
 * keys the entity moves and if you release it will stop. Easing simulates friction.
 * @param {number} [acceleration=65] - Determines the acceleration given
 * to the entity when pressing the keys.
 * @param {bool} [enabled=true] - To completely enable or disable the controls
 * @param {bool} [fly=false] - Determines if the direction of the movement sticks
 * to the plane where the entity started off or if there are 6 degrees of
 * freedom as a diver underwater or a plane flying.
 * @param {string} [wsAxis='z'] - The axis that the W and S keys operate on
 * @param {string} [adAxis='x'] - The axis that the A and D keys operate on
 * @param {bool} [wsInverted=false] - WS Axis is inverted
 * @param {bool} [adInverted=false] - AD Axis is inverted
 * @param {debug} [debug=false] - Whether to show debugging information in the log.
 */
require('./lib/Object.polyfill.js');

var Peer = require('peerjs'),
	URLParser = require('./lib/URLParser').URLParser;

var MAX_DELTA = 0.2;

module.exports = {
	/*******************************************************************
	* Schema
	*/

	schema: {
		// WebRTC configuration.
		url: { default: '' },
		key: { default: '' },
		id: { default: '' },

		// Movement configuration.
		easing: { default: 20 },
		acceleration: { default: 65 },
		enabled: { default: true },
		fly: { default: false },
		wsAxis: { default: 'z', oneOf: [ 'x', 'y', 'z' ] },
		adAxis: { default: 'x', oneOf: [ 'x', 'y', 'z' ] },
		wsInverted: { default: false },
		wsEnabled: { default: true },
		adInverted: { default: false },
		adEnabled: { default: true },

		// Debugging.
		debug: { default: false }
	},


	/*******************************************************************
	* Styles
	*/

	styles: {
		overlay: {
			position: 'absolute',
			top: '20px',
			left: '20px',
			maxWidth: 'calc(100% - 40px)',
			boxSizing: 'border-box',
			padding: '0.5em',
			color: '#FFF',
			background: 'rgba(0,0,0,0.5)',
			borderRadius: '3px',
			fontFamily: 'monospace',
			fontSize: '1.2em'
		}
	},

	/*******************************************************************
	* Initialization
	*/

	/**
	 * Called once when component is attached. Generally for initial setup.
	 */
	init: function () {
		/** @type {Peer} WebRTC P2P connection broker. */
		this.peer = null;

		/** @type {DataConnection} DataConnection to remote client. */
		this.conn = null;

		/** @type {Element} Overlay element to display local client ID. */
		this.overlay = null;

		this.setupConnection();
		this.setupControls();
	},

	setupControls: function () {
		var scene = this.el.sceneEl;
		this.prevTime = Date.now();
		// To keep track of the pressed keys
		this.keys = {};
		this.velocity = new THREE.Vector3();
		scene.addBehavior(this);
	},

	/*******************************************************************
	* Movement
	*/

	/**
	 * Called when component is attached and when component data changes.
	 * Generally modifies the entity based on the data.
	 */
	update: function (previousData) {
		var data = this.data;
		var acceleration = data.acceleration;
		var easing = data.easing;
		var velocity = this.velocity;
		var time = window.performance.now();
		var delta = (time - this.prevTime) / 1000;
		var keys = this.keys;
		var movementVector;
		var adAxis = data.adAxis;
		var wsAxis = data.wsAxis;
		var adSign = data.adInverted ? -1 : 1;
		var wsSign = data.wsInverted ? -1 : 1;
		var el = this.el;
		this.prevTime = time;

		// If data has changed or FPS is too low
		// we reset the velocity
		if (previousData || delta > MAX_DELTA) {
		  velocity[adAxis] = 0;
		  velocity[wsAxis] = 0;
		  return;
		}

		velocity[adAxis] -= velocity[adAxis] * easing * delta;
		velocity[wsAxis] -= velocity[wsAxis] * easing * delta;

		var position = el.getComputedAttribute('position');

		if (data.enabled) {
		  if (data.adEnabled) {
			if (keys.A) { velocity[adAxis] -= adSign * acceleration * delta; } // Left
			if (keys.D) { velocity[adAxis] += adSign * acceleration * delta; } // Right
		  }
		  if (data.wsEnabled) {
			if (keys.W) { velocity[wsAxis] -= wsSign * acceleration * delta; } // Up
			if (keys.S) { velocity[wsAxis] += wsSign * acceleration * delta; } // Down
		  }
		}

		movementVector = this.getMovementVector(delta);
		el.object3D.translateX(movementVector.x);
		el.object3D.translateY(movementVector.y);
		el.object3D.translateZ(movementVector.z);

		el.setAttribute('position', {
		  x: position.x + movementVector.x,
		  y: position.y + movementVector.y,
		  z: position.z + movementVector.z
		});	
	},

	getMovementVector: (function () {
		var direction = new THREE.Vector3(0, 0, 0);
		var rotation = new THREE.Euler(0, 0, 0, 'YXZ');
		return function (delta) {
			var velocity = this.velocity;
			var elRotation = this.el.getAttribute('rotation');
			direction.copy(velocity);
			direction.multiplyScalar(delta);
			if (!elRotation) { return direction; }
			if (!this.data.fly) { elRotation.x = 0; }
			rotation.set(
				THREE.Math.degToRad(elRotation.x),
				THREE.Math.degToRad(elRotation.y),
				0
			);
			direction.applyEuler(rotation);
			return direction;
		};
	})(),

	/*******************************************************************
	* WebRTC Connection
	*/

	setupConnection: function () {
		var id = this.data.id || null;

		if (this.data.key && this.data.url) {
			console.warn('If both key and url are provided, only key will be used.');
		} else if (!this.data.key && !this.data.url) {
			console.warn('WebRTC connection cannot be made without API key or host.');
		}

		if (this.data.key) {
			this.peer = new Peer(id, {
				key: this.data.key,
				debug: this.data.debug ? 3 : 0
			});
		} else if (this.data.url) {
			var url = URLParser.parse(this.data.url);
			this.peer = new Peer(id, {
				host: url.getProtocol() + '//' + url.getHost(),
				path: url.getPathname(),
				port: url.getPort(),
				debug: this.data.debug ? 3 : 0
			});
		}

		// Debugging
		if (this.data.debug) {
			this.peer.on('open', console.info.bind(console, 'peer:open("%s")'));
		}

		this.peer.on('open', this.createOverlay.bind(this));
		this.peer.on('connection', this.onConnection.bind(this));
		this.peer.on('error', function (error) {
			if (this.data.debug) console.error('peer:error(%s)', error.message);
			if (error.type === 'browser-incompatible') {
				this.createOverlay('Client Controls: Sorry, current browser does not support WebRTC.');
			}
		}.bind(this));
	},

	onConnection: function (conn) {
		if (this.data.debug) console.info('peer:connection(%s)', conn.peer);
		conn.on('data', this.onEvent.bind(this));
		this.overlay.remove();
	},

	createOverlay: function (text) {
		this.overlay = document.createElement('div');
		this.overlay.textContent = text;
		Object.assign(this.overlay.style, this.styles.overlay);
		document.body.appendChild(this.overlay);
	},

	/*******************************************************************
	* Remote event propagation
	*/

	onEvent: function (event) {
		if (!event.type) {
			if (this.data.debug) console.warn('Missing event type.');
			return;
		}

		switch (event.type) {
			case 'keyboard':
				this.keys = event.state;
				if (this.data.debug) {
					console.log('event:keyboard(%s)', Object.keys(event.state).toString());
				}
				break;
			default:
				if (this.data.debug) console.warn('Unknown event type: "%s"', event.type);
		}
	},

	/*******************************************************************
	* Dealloc
	*/

	/**
	 * Called when a component is removed (e.g., via removeAttribute).
	 * Generally undoes all modifications to the entity.
	 */
	remove: function () {
		if (this.peer) this.peer.destroy();
	}
};