/**
 * BluetoothScale - WH-C06 Bluetooth Scale Integration
 *
 * Handles connection and weight data from WH-C06 (Weiheng) Bluetooth scales.
 * Requires Chrome flag: chrome://flags/#enable-experimental-web-platform-features
 *
 * @class
 * @fires scale:connected - When device successfully connects
 * @fires scale:disconnected - When device disconnects
 * @fires scale:weight - On each weight reading { weight, max }
 * @fires scale:error - On errors { message }
 */
export default class BluetoothScale {
	/**
	 * Company identifier for WH-C06 scale (also used by TomTom International BV)
	 * @type {number}
	 * @private
	 * @static
	 * @readonly
	 */
	static COMPANY_ID = 0x0100; // 256 in decimal

	/**
	 * Byte offset for weight data in manufacturer advertisement packets
	 * @type {number}
	 * @private
	 * @static
	 * @readonly
	 */
	static WEIGHT_OFFSET = 10;

	/**
	 * Device name prefix for WH-C06 scales
	 * @type {string}
	 * @private
	 * @static
	 * @readonly
	 */
	static DEVICE_PREFIX = 'IF_';

	constructor() {
		/**
		 * The connected Bluetooth device
		 * @type {BluetoothDevice|null}
		 * @private
		 */
		this.device = null;

		/**
		 * Current weight reading in kg
		 * @type {number}
		 * @private
		 */
		this.currentWeight = 0;

		/**
		 * Maximum weight recorded this session in kg
		 * @type {number}
		 * @private
		 */
		this.maxWeight = 0;

		/**
		 * Connection state
		 * @type {boolean}
		 * @private
		 */
		this.connected = false;

		/**
		 * Bound advertisement handler for cleanup
		 * @type {Function|null}
		 * @private
		 */
		this.advertisementHandler = null;

		/**
		 * Bound disconnect handler for cleanup
		 * @type {Function|null}
		 * @private
		 */
		this.disconnectHandler = null;

		/**
		 * Flag to track if disconnect was unexpected
		 * @type {boolean}
		 * @private
		 */
		this.unexpectedDisconnect = false;

		/**
		 * Timestamp of last received packet (for watchdog)
		 * @type {number}
		 * @private
		 */
		this.lastPacketTime = 0;

		/**
		 * Watchdog interval ID for detecting packet loss
		 * @type {number|null}
		 * @private
		 */
		this.watchdogInterval = null;
	}

	/**
	 * Timeout threshold in ms before considering device disconnected
	 * @type {number}
	 * @private
	 * @static
	 * @readonly
	 */
	static PACKET_TIMEOUT_MS = 5000; // 5 seconds without packets = disconnected

	/**
	 * Connects to a WH-C06 Bluetooth scale
	 * @returns {Promise<boolean>} True if connection successful, false otherwise
	 */
	async connect() {
		try {
			// Simple cleanup if somehow still connected
			if (this.device) {
				console.log('[BluetoothScale] Cleaning up before reconnect');
				this.disconnect();
				await new Promise(resolve => setTimeout(resolve, 200));
			}

			// Check browser support
			if (!navigator.bluetooth) {
				throw new Error('Web Bluetooth not supported');
			}
			if (!BluetoothDevice.prototype.watchAdvertisements) {
				throw new Error('watchAdvertisements() not available');
			}

			// ALWAYS request fresh device
			this.device = await navigator.bluetooth.requestDevice({
				filters: [
					{ namePrefix: BluetoothScale.DEVICE_PREFIX },
					{ manufacturerData: [{ companyIdentifier: BluetoothScale.COMPANY_ID }] }
				],
				optionalManufacturerData: [BluetoothScale.COMPANY_ID]
			});

			// Fresh handlers
			this.advertisementHandler = (event) => this._handleAdvertisement(event);
			this.device.addEventListener('advertisementreceived', this.advertisementHandler);

			this.disconnectHandler = () => this._handleUnexpectedDisconnect();
			this.device.addEventListener('gattserverdisconnected', this.disconnectHandler);

			await this.device.watchAdvertisements();

			console.log('[BluetoothScale] watchAdvertisements() succeeded');
			console.log('[BluetoothScale] Device.watchingAdvertisements:', this.device.watchingAdvertisements);
			console.log('[BluetoothScale] Device.name:', this.device.name);
			console.log('[BluetoothScale] Device.id:', this.device.id);

			this.connected = true;
			this._startWatchdog();

			this._emitEvent('scale:connected', {
				deviceName: this.device.name,
				deviceId: this.device.id
			});

			console.log('[BluetoothScale] Connected fresh');
			return true;

		} catch (error) {
			console.error('[BluetoothScale] Connection error:', error);
			this._emitEvent('scale:error', { message: error.message, type: 'connection' });
			this.connected = false;
			return false;
		}
	}

	/**
	 * Disconnects from the Bluetooth scale
	 */
	async disconnect() {
		this._stopWatchdog();

		const finalMax = this.maxWeight;
		const wasUnexpected = this.unexpectedDisconnect;

		if (this.device) {
			// Remove listeners
			if (this.advertisementHandler) {
				this.device.removeEventListener('advertisementreceived', this.advertisementHandler);
			}
			if (this.disconnectHandler) {
				this.device.removeEventListener('gattserverdisconnected', this.disconnectHandler);
			}

			// Force Chrome to forget the device (clears internal cache)
			try {
				if (typeof this.device.forget === 'function') {
					await this.device.forget();
					console.log('[BluetoothScale] Device forgotten from browser cache');
				}
			} catch (e) {
				console.warn('[BluetoothScale] Could not forget device:', e);
			}
		}

		// Wipe everything
		this.device = null;
		this.advertisementHandler = null;
		this.disconnectHandler = null;
		this.connected = false;
		this.currentWeight = 0;
		this.maxWeight = 0;
		this.lastPacketTime = 0;
		this.unexpectedDisconnect = false;

		this._emitEvent('scale:disconnected', {
			finalMaxWeight: finalMax,
			unexpected: wasUnexpected
		});
	}

	/**
	 * Checks if scale is currently connected
	 * @returns {boolean} True if connected
	 */
	isConnected() {
		return this.connected && this.device !== null;
	}

	/**
	 * Gets the current weight reading
	 * @returns {number} Current weight in kg
	 */
	getCurrentWeight() {
		return this.currentWeight;
	}

	/**
	 * Gets the maximum weight recorded this session
	 * @returns {number} Max weight in kg
	 */
	getMaxWeight() {
		return this.maxWeight;
	}

	/**
	 * Resets the maximum weight counter
	 */
	resetMax() {
		this.maxWeight = 0;

		// Emit weight event with reset max
		this._emitEvent('scale:weight', {
			weight: this.currentWeight,
			max: this.maxWeight,
			maxReset: true
		});
	}

	/**
	 * Handles incoming advertisement packets from the scale
	 * @param {Event} event - Advertisement received event
	 * @private
	 */
	_handleAdvertisement(event) {
		console.log('[BluetoothScale] ===== ADVERTISEMENT PACKET RECEIVED =====');
		console.log('[BluetoothScale] Device:', event.device?.name);
		console.log('[BluetoothScale] ManufacturerData size:', event.manufacturerData?.size);
		console.log('[BluetoothScale] Company IDs:', Array.from(event.manufacturerData?.keys() || []));

		try {
			// Update last packet timestamp (watchdog check)
			this.lastPacketTime = Date.now();

			// Check if manufacturer data exists
			if (!event.manufacturerData || event.manufacturerData.size === 0) {
				return;
			}

			// Look for our company ID
			const dataView = event.manufacturerData.get(BluetoothScale.COMPANY_ID);
			if (!dataView) {
				return;
			}

			// Ensure we have enough bytes to read weight
			if (dataView.byteLength < BluetoothScale.WEIGHT_OFFSET + 2) {
				console.warn('[BluetoothScale] Insufficient data in packet');
				return;
			}

			// Parse weight from bytes 10-11 (little-endian 16-bit integer)
			// High byte (bit shift) | Low byte
			const rawWeight = (dataView.getUint8(BluetoothScale.WEIGHT_OFFSET) << 8)
							| dataView.getUint8(BluetoothScale.WEIGHT_OFFSET + 1);

			// Convert to kg (device sends weight * 100)
			const weightInKg = rawWeight / 100;

			// Update current weight
			this.currentWeight = weightInKg;

			// Update max weight if current exceeds it
			if (weightInKg > this.maxWeight) {
				this.maxWeight = weightInKg;
			}

			// Emit weight event
			this._emitEvent('scale:weight', {
				weight: this.currentWeight,
				max: this.maxWeight,
				timestamp: Date.now()
			});

		} catch (error) {
			console.error('[BluetoothScale] Error parsing weight data:', error);

			this._emitEvent('scale:error', {
				message: error.message,
				type: 'parsing'
			});
		}
	}

	/**
	 * Handles unexpected disconnection (device powered off, out of range, etc.)
	 * @private
	 */
	_handleUnexpectedDisconnect() {
		console.warn('[BluetoothScale] Device disconnected unexpectedly');
		this.unexpectedDisconnect = true;
		this.disconnect();
	}

	/**
	 * Emits a custom event on the window object
	 * @param {string} eventName - Name of the event
	 * @param {Object} detail - Event detail data
	 * @private
	 */
	_emitEvent(eventName, detail) {
		const event = new CustomEvent(eventName, {
			detail,
			bubbles: true,
			cancelable: false
		});
		window.dispatchEvent(event);
	}

	/**
	 * Starts the watchdog timer to detect packet loss
	 * @private
	 */
	_startWatchdog() {
		// Clear any existing watchdog
		this._stopWatchdog();

		// Initialize last packet time
		this.lastPacketTime = Date.now();

		// Check every 1 second for packet timeout
		this.watchdogInterval = setInterval(() => {
			const timeSinceLastPacket = Date.now() - this.lastPacketTime;

			if (timeSinceLastPacket > BluetoothScale.PACKET_TIMEOUT_MS) {
				console.warn('[BluetoothScale] No packets received for', timeSinceLastPacket, 'ms - assuming disconnected');

				// Mark as unexpected disconnect and clean up
				this.unexpectedDisconnect = true;
				this.disconnect();
			}
		}, 1000); // Check every second
	}

	/**
	 * Stops the watchdog timer
	 * @private
	 */
	_stopWatchdog() {
		if (this.watchdogInterval) {
			clearInterval(this.watchdogInterval);
			this.watchdogInterval = null;
		}
	}
}
