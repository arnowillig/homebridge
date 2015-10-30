var types = require("hap-nodejs/accessories/types.js");
var Service = require("hap-nodejs").Service;
var Characteristic = require("hap-nodejs").Characteristic;
var net = require('net');

function FBAHAPlatform(log, config) {
	this.log = log;
	this.server = config["server"] || "192.168.178.1";
	this.port   = config["port"] || 2002;
	this.handle = 0;
	this.foundAccessories = [];
	this.allFound = false;


	this.log("Initialising FBAHAPlatform... "+this.server+":"+this.port);
}

FBAHAPlatform.prototype = {
	accessories: function(callback) {
        	this.log("Fetching devices...");
		this.connect(callback);

		// var foundAccessories = [];
		/*
		var accessory = new FBAHAAccessory(this.log, this);
		if (accessory && Object.getOwnPropertyNames(accessory).length) {
			foundAccessories.push(accessory);
		}
		*/
		// callback(foundAccessories);
	},
	connect: function(callback) {
		var self = this;
		self.log("Connecting");
		this.disconnect();
		this.sock = new net.Socket();
		this.sock.connect(this.port, this.server, function() {
			self.log("Connected");
			self.sendData(0x00, "00022005"); 		// REGISTER
		});
		this.sock.on("close", function() {
			self.log("Connection closed");
		});
		this.sock.on("data", function(data) {
			// >>         0003000c0000000000022005
			// << 010300100000004c0000004c00022005
			if (self.handle == 0) {
				self.handle = data.readUInt32BE(4)
				self.log('Received handle: ', self.handle);

				self.sendData(0x03, "0000038200000000"); 	// LISTEN
				self.sendData(0x05, "00000000"); 		// CONFIG_REQ
			} else {
				self.parseData(data,callback);
			}
		});
	},
	disconnect: function() {
		if (this.sock) {
			this.log("Disconnecting");
			this.sock.destroy();
			this.sock = undefined;
			this.allFound = false;
		}
	},
	sendData: function(cmd, msg) {
		var msgBuffer =	new Buffer(msg, 'hex');
		var len = 8 + msgBuffer.length
		var buf = new Buffer(8);
		buf.writeUInt8(cmd,0);
		buf.writeUInt8(0x03,1);
		buf.writeUInt16BE(len,2);
		buf.writeUInt32BE(this.handle,4);
		var buf = Buffer.concat([buf,msgBuffer])
		this.log("sendData ",len,cmd,buf.toString('hex'));
		this.sock.write(buf,len)
	},
	getAccessory: function(fbId) {
		for (var accessory of this.foundAccessories) {
			if (accessory.deviceId == fbId) {
				return accessory;
			}
		}
		return undefined;
	},
	parseData: function(data,callback) {
		while(data.length>4) {
			var cmd = data.readUInt8(0);
			var len = data.readUInt16BE(2);
	
			if (cmd!=6 && !this.allFound) {
				this.allFound = true;
				callback(this.foundAccessories);
			}
	
			if (cmd==6) { // CONFIG_REQ

				var fbId    = data.readUInt16BE(16); 
				var fbAct   = data.readUInt8(18);
				var fbType  = data.readUInt32BE(20);
				var fbLsn   = data.readUInt32BE(28);
				var name    = data.toString('utf8',28,28+80);

				var newAcc = new FBAHAAccessory(this.log, this, fbId, fbAct, fbType, fbLsn, name);
				this.foundAccessories.push(newAcc);

				// this.log('Received data: ',len, data.toString('hex'));
				var last = data.readUInt8(1);
				if (last==2 || last==3) {
					this.allFound = true;
					callback(this.foundAccessories);
				}
				
			} else if (cmd==0x04) {
				this.log('Received data: ',len, cmd, data.toString('hex'));
			} else if (cmd==0x07) {
				var fbId   = data.readUInt16BE(8); 
				
				var accessory = this.getAccessory(fbId);

				var pack   = data.slice(16,len);
				while (pack.length) {
					var type = pack.readUInt32BE(0);
					var plen = pack.readUInt16BE(4);
					var pyld = pack.readUInt32BE(8);
					var val  = pyld;
				
					switch(type) {
					case 7: // connected
						break;
					case 8: // disconnected
						break;
					case 10: // configChanged
						break;
					case 15: // state
						val = undefined;
						accessory.lightbulbService.getCharacteristic(Characteristic.On).setValue(pyld ? 1 : 0);
						break;
					case 16: // relayTimes
						break;
					case 18: // current
						val = (pyld/10000.0).toFixed(2)+' A';
						break;
					case 19: // voltage
						val = (pyld/1000.0).toFixed(2)+' V';
						break;
					case 20: // power
						val = (pyld/100.0).toFixed(2)+' W';
						break;
					case 21: // energy
						val = (pyld/1.0).toFixed(1)+' Wh';
						break;
					case 22: // powerFactor
						val = (pyld/1.0).toFixed(1)+'';
						break;
					case 23: // temperature
						// TODO var pyld2 = pack.readUInt32BE(12);
						accessory.temperatureService.getCharacteristic(Characteristic.CurrentTemperature).setValue(pyld/10.0);
						// val = (pyld/10.0).toFixed(1)+' °C';
						val = undefined;
						break;
					case 35: // options
						break;
					case 37: // control
						break;
					}
					if (val) {
						this.log("TODO UPDATE: '"+accessory.name+"' Charactaristic: #"+type+" Value: "+val);
					}
					pack = pack.slice(16);
				}
			} else {
				this.log('Received data: ',len, cmd, data.toString('hex'));
			}
			data = data.slice(len);
		}
	}
};

function FBAHAAccessory(log, client, fbId, fbAct, fbType, fbLsn, name) {
	this.log        = log;
	this.client     = client;
	this.name 	= name;
	this.powerOn 	= false;
	this.temperature = 0;
	this.deviceId	= fbId;
	this.serial	= fbLsn; 
	this.model	= fbType;
	switch (fbType) {
	case 2:
		this.manu = "AVM";
		this.model = "AVM FRITZ!Dect Powerline 546E"; break;
	case 3:
		this.manu = "Comet";
		this.model = "DECT"; break;
	case 9:
		this.manu = "AVM";
		this.model = "FRITZ!Dect 200"; break;
	case 11:
		this.manu = "AVM";
		this.model = "DeviceGroup"; break;
	default:
		this.manu = "Unknown manufacturer";
		this.model = "Unknown Model "+fbType;
	}

	this.log("Creating new FBAHAAccessory '"+this.name+"' ("+this.manu+" "+this.model+")");
}

FBAHAAccessory.prototype = {
	identify: function(callback) {
		this.log('['+this.name+'] identify requested!');
		callback(); // success
	},
	setPowerState: function(powerOn, callback) {
		if (powerOn) {
			this.log("Setting power state of '"+this.name+"' to on");
		} else {
			this.log("Setting power state of '"+this.name+"' to off");
		}
		this.powerOn = powerOn;
		callback();
	},
	getPowerState: function(callback) {
			this.log("Getting power state "+this.powerOn);
			callback(this.powerOn);
	},
	setCurrentTemperature: function(temperature, callback) {
		this.temperature = temperature;
		this.log("Setting current temperature of '"+this.name+"' to "+this.temperature);
		callback();
	},
	getCurrentTemperature: function(callback) {
			this.log("Getting current temperature "+this.temperature);
			callback(this.temperature);
	},
	getServices: function() {
		var informationService = new Service.AccessoryInformation();
		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manu)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial);
		var lightbulbService = new Service.Lightbulb();

		lightbulbService.getCharacteristic(Characteristic.On)
			.on('set', this.setPowerState.bind(this))
			.on('get', this.getPowerState.bind(this));
		this.lightbulbService = lightbulbService;

		var temperatureService = new Service.TemperatureSensor();		
		temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
			.on('set', this.setCurrentTemperature.bind(this))
			.on('get', this.getCurrentTemperature.bind(this));
		this.temperatureService = temperatureService;


		return [informationService,lightbulbService,temperatureService];
	}
}

module.exports.platform = FBAHAPlatform;

