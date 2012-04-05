/***
	A very basic implementation of Pd's dsp engine for the web.
	
	Copyright Chris McCormick, 2010.
	Licensed under the terms of the AGPLv3, or a later version of that license.
	See the file COPYING for details.
	(Basically if you provide this software via the network you need to make the source code available, but read the license for details).
***/

// TODO: message should take an array, instead of having to parse everything themselves.
// TODO: generic event/callback system

(function(Pd){


/************************** Mixins ******************************/

    var StopEventMixin = {

        init: function(tableName) {
            // callbaks to execute when the object stop's recording for any reason
            this._onStopCbs = [];
        },
        
        onStop: function(callback) {
            this._onStopCbs.push(callback);
        },

        _execOnStop: function() {
            var callbacks = this._onStopCbs;
            callbacks.reverse();
            while(callbacks.length) callbacks.pop().call(this, this);
        }

    };


/************************** Basic objects ******************************/

    Pd.objects = {
	// null placeholder object for objects which don't exist
        'null': {},
        'cnv': {}
    };

    Pd.objects['loadbang'] = Pd.Object.extend({

        outletTypes: ['outlet'],

        load: function() {
            this.outlets[0].message('bang');
        }

    });

    Pd.objects['print'] = Pd.Object.extend({

		inletTypes: ['inlet'],

        init: function(printName) {
            this.printName = (printName || 'print');
        },

        message: function(inletId, message) {
            Pd.log(this.printname + ': ' + message);
        }

    });

    Pd.objects['table'] = Pd.Object.extend({

        init: function(name, size) {
            this.name = name || null;
            this.size = size;
            this.data = new Pd.arrayType(size);
        },

    });

/************************** DSP objects ******************************/
	
	// basic oscillator
	Pd.objects['osc~'] = Pd.Object.extend({

		inletTypes: ['inlet~', 'inlet'],
		outletTypes: ['outlet~'],

		init: function(freq) {
			this.freq = freq || 0;
			this.phase = 0;
		},

		dspTick: function() {
            var dspInlet = this.inlets[0];
            var outBuff = this.outlets[0].getBuffer();

            // We listen to the first inlet for frequency, only
            // if there's actually a dsp source connected to it.
            if (dspInlet.hasDspSources()) {
			    var inBuff = dspInlet.getBuffer();
                var J = 2 * Math.PI / this.patch.sampleRate;
			    for (var i=0; i<outBuff.length; i++) {
                    this.phase += J * inBuff[i];
				    outBuff[i] = Math.cos(this.phase);
			    }
            } else {
                var K = 2 * Math.PI * this.freq / this.patch.sampleRate;
			    for (var i=0; i<outBuff.length; i++) {
                    this.phase += K;
				    outBuff[i] = Math.cos(this.phase);
			    }
            }
		},

        // TODO : reset phase takes float and no bang
		message: function(inletId, msg) {
			if (inletId === 0) this.freq = this.toFloat(msg);
            else if (inletId === 1 && msg == 'bang') this.phase = 0;
		}

	});


	// digital to analogue converter (sound output)
	Pd.objects['dac~'] = Pd.Object.extend({

		endPoint: true,
		inletTypes: ['inlet~', 'inlet~'],

		dspTick: function() {
			var inBuff1 = this.inlets[0].getBuffer();
			var inBuff2 = this.inlets[1].getBuffer();
            var output = this.patch.output;
			// copy interleaved data from inlets to the graph's output buffer
			for (var i=0; i<output.length; i++) {
				output[i * 2] += inBuff1[i];
				output[i * 2 + 1] += inBuff2[i];
			}
		}
	});


	// creates simple dsp lines
	Pd.objects['line~'] = Pd.Object.extend(StopEventMixin, {

		inletTypes: ['inlet'],
		outletTypes: ['outlet~'],

		init: function() {
            StopEventMixin.init.call(this);
			// what the value was at the start of the line
			this.y0 = 0;
			// the destination value we are aiming for
			this.y1 = 0;
            // this stores the current index 
            this.n = 0;
			// this stores the index max the line must reach
			this.nMax = 0;
			// we want to use the dsptick method that returns a constant value for now
			this.toDspConst(this.y0);
		},

		// write a constant value to our output buffer for every sample
		dspTickConst: function() {
            var outBuff = this.outlets[0].getBuffer();
			for (var i=0; i<outBuff.length; i++) outBuff[i] = this.y0;
		},

		// write this correct value of the line at each sample
		dspTickLine: function() {
            var outBuff = this.outlets[0].getBuffer();
            var outBuffLength = outBuff.length;
            var slope = this.slope;
			for (var i=0; i<outBuffLength; i++, this.n++) {
				// if we've reached the end of our line, we fill-in the rest of the buffer,
                // break, and switch back to the constant method.
				if (this.n >= this.nMax) {
                    for (var j=i; j<outBuffLength; j++) outBuff[j] = this.y1;
                    this.toDspConst(this.y1);
                    this._execOnStop();
                    break;
				} else {
					outBuff[i] = this.n * slope + this.y0;
				}
			}
		},

		message: function(inletId, message) {
			if (inletId == 0) {
				var parts = this.toArray(message);
				// if this is a single valued message we want line~ to output a constant value,
                // otherwise the message is taken as [targetY duration(
				if (parts.length == 1) {
					var y0 = this.toFloat(parts[0]);
					if (!isNaN(y0)) this.toDspConst(y0);
				} else if (parts.length >= 2){
					var y1 = this.toFloat(parts[0]);
					var duration = this.toFloat(parts[1]);
					if (!isNaN(y1) && !isNaN(duration)) this.toDspLine(y1, duration)
				}
			}
		},

        toDspConst: function(val) {
            this.y0 = val;
			this.dspTick = this.dspTickConst;
        },

        toDspLine: function(val, duration) {
			this.y1 = val;
            this.n = 0;
			this.nMax = duration * this.patch.sampleRate / 1000;
            this.slope = (this.y1 - this.y0) / this.nMax;
			this.dspTick = this.dspTickLine;
        }
	});	


/************************** DSP arithmetics ******************************/

    var DSPArithmBase = Pd.Object.extend({

		inletTypes: ['inlet~', 'inlet~'],
		outletTypes: ['outlet~'],

		init: function(val) {
			this.val = (val || 0);
		},

        message: function(inletId, msg) {
            if (inletId == 1) {
                var val = this.toFloat(msg);
                if(!isNaN(val)) this.val = val;
            } 
        }

    });


	// dsp multiply object
	Pd.objects['*~'] = DSPArithmBase.extend({

		dspTick: function() {
            var inBuff1 = this.inlets[0].getBuffer();
            var outBuff = this.outlets[0].getBuffer();
            if (this.inlets[1].hasDspSources()) {
                var inBuff2 = this.inlets[1].getBuffer();
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = inBuff1[i] * inBuff2[i];
			    }
            } else {
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = inBuff1[i] * this.val;
			    }
            }
		}

	});


	// dsp divide object (d_arithmetic.c line 454 - over_perform() )
	Pd.objects['/~'] = DSPArithmBase.extend({

		dspTick: function() {
            var inBuff1 = this.inlets[0].getBuffer();
            var outBuff = this.outlets[0].getBuffer();
            var val2;
			// return zero if denominator is zero
            if (this.inlets[1].hasDspSources()) {
                var inBuff2 = this.inlets[1].getBuffer();
			    for (var i=0; i < outBuff.length; i++) {
                    val2 = inBuff2[i];
				    outBuff[i] = (val2 ? inBuff1[i] / inBuff2[i] : 0);
			    }
            } else {
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = (this.val ? inBuff1[i] / this.val : 0);
			    }
            }
		}

	});
	

	// dsp addition object
	Pd.objects['+~'] = DSPArithmBase.extend({

		dspTick: function() {
            var inBuff1 = this.inlets[0].getBuffer();
            var outBuff = this.outlets[0].getBuffer();
            if (this.inlets[1].hasDspSources()) {
                var inBuff2 = this.inlets[1].getBuffer();
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = inBuff1[i] + inBuff2[i];
			    }
            } else {
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = inBuff1[i] + this.val;
			    }
            }
		}

	});


	// dsp substraction object
	Pd.objects['-~'] = DSPArithmBase.extend({

		dspTick: function() {
            var inBuff1 = this.inlets[0].getBuffer();
            var outBuff = this.outlets[0].getBuffer();
            if (this.inlets[1].hasDspSources()) {
                var inBuff2 = this.inlets[1].getBuffer();
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = inBuff1[i] - inBuff2[i];
			    }
            } else {
			    for (var i=0; i < outBuff.length; i++) {
				    outBuff[i] = inBuff1[i] - this.val;
			    }
            }
		}

	});

/************************** DSP tables ******************************/

    // Baseclass for tabwrite~, tabread~ and others ...
    var DSPTabBase = Pd.Object.extend({

        init: function(tableName) {
            this.tableName = tableName;
            this.table = null;
        },

        load: function() {
            this.setTableName(this.tableName);
        },

        setTableName: function(name) {
            this.tableName = name;
            if (this.patch) {
                var table = this.patch.getTableByName(name);
                if (!table) throw (new Error('table with name ' + name + ' doesn\'t exist'));
                this.table = table;
                this.tableChanged();
            }
        },

        // Hook for when a table was successfully loaded or changed
        tableChanged: function() {}
    });


    // read data from a table with no interpolation
    Pd.objects['tabread~'] = DSPTabBase.extend({

        inletTypes: ['inlet~'],
        outletTypes: ['outlet~'],

        init: function(tableName) {
            DSPTabBase.prototype.init.call(this, tableName);
            this.toDspTickZeros();
        },

        dspTickReading: function() {
            var outBuff = this.outlets[0].getBuffer();
            var inBuff = this.inlets[0].getBuffer();
            var tableMax = this.table.size - 1;
            var tableData = this.table.data;
            var s;
            // cf. pd : Incoming values are truncated to the next lower integer,
            // and values out of bounds get the nearest (first or last) point.
            for (var i=0; i<outBuff.length; i++) {
                s = Math.floor(inBuff[i]);
                outBuff[i] = tableData[(s >= 0 ? (s > tableMax ? tableMax : s) : 0)];
            }
        },

        tableChanged: function() {
            this.dspTick = this.dspTickReading;
        },

        message: function(inletId, msg) {
			if (inletId === 0) {
                var parts = this.toArray(msg);
                if (parts[0] == 'set') this.setTableName(parts[1]);
            }
        }
    });


    // play data from a table with no interpolation
    Pd.objects['tabplay~'] = DSPTabBase.extend(StopEventMixin, {

        inletTypes: ['inlet'],
        outletTypes: ['outlet~'],

        init: function(tableName) {
            DSPTabBase.prototype.init.call(this, tableName);
            StopEventMixin.init.call(this);
            this.pos = 0;
            this.posMax = 0;        // the position after the last position to be read
            this.toDspTickZeros();
        },

        dspTickReading: function() {
            var outBuff = this.outlets[0].getBuffer();
            var iMax = Math.min(outBuff.length, this.posMax - this.pos); // +1 cause comparing length to position
            for (var i=0; i<iMax; i++, this.pos++) {
                outBuff[i] = this.table.data[this.pos];
            }
            // If we've reached the last position, that's it
            if (this.pos == this.posMax) {
                for (var j=i; j<outBuff.length; j++) outBuff[j] = 0;
                this.toDspTickZeros();
                this._execOnStop();
            }
        },

        message: function(inletId, msg) {
			if (inletId === 0) {
                var parts = this.toArray(msg);
                var method = parts[0];
                if (method == 'set') {
                    this.setTableName(parts[1]);
                    this.toDspTickZeros();
                } else if (msg == 'bang') {
                    this.toDspTickReading(0);
                } else if (parts.length == 1) {
                    var startPos = this.toFloat(parts[0]);
                    this.toDspTickReading(startPos);
                } else if (parts.length == 2) {
                    var startPos = this.toFloat(parts[0]);
                    var sampleNum = this.toFloat(parts[1]);
                    this.toDspTickReading(startPos, sampleNum);
                }
            }
        },

        toDspTickReading: function(startPos, sampleNum) {
            if (startPos >= this.table.size - 1) return;
            sampleNum = sampleNum || (this.table.size - startPos);
            this.pos = startPos;
            this.posMax = Math.min(startPos + sampleNum, this.table.size);
            this.dspTick = this.dspTickReading;
        }

    });


    // read data from a table with no interpolation
    Pd.objects['tabwrite~'] = DSPTabBase.extend(StopEventMixin, {

        inletTypes: ['inlet~'],
        endPoint: true,

        init: function(tableName) {
            DSPTabBase.prototype.init.call(this, tableName);
            StopEventMixin.init.call(this);
            this.pos = 0;
            this.toDspTickNoOp();
        },

        dspTickWriting: function() {
            var inBuff = this.inlets[0].getBuffer();
            var iMax = Math.min(inBuff.length, this.table.size - this.pos);
            for (var i=0; i<iMax; i++, this.pos++) {
                this.table.data[this.pos] = inBuff[i];
            }
            // If we reached table size, that's it
            if (this.pos == this.table.size) {
                this.toDspTickNoOp();
                this._execOnStop();
            }
        },

        message: function(inletId, msg) {
			if (inletId === 0) {
                var parts = this.toArray(msg);
                var method = parts[0];
                if (method == 'set') {
                    this.setTableName(parts[1]);
                    this.toDspTickNoOp();
                } else if (method == 'start') {
                    var pos = 0;
                    if (parts.length > 1) {
                        var pos = this.toFloat(parts[1]);
                        if (isNaN(pos)) throw (new Error('invalid start position'));
                        pos = Math.floor(pos);
                    }
                    this.toDspTickWriting(pos);
                } else if (msg == 'bang') {
                    this.toDspTickWriting(0);
                } else if (method == 'stop') {
                    this.toDspTickNoOp();
                }
            }
        },

        toDspTickWriting: function(start) { 
            this.dspTick = this.dspTickWriting;
            this.pos = start;
        }
    });


/************************** Misc non-DSP ******************************/

	//convert midi notes to frequency
	Pd.objects['mtof'] = Pd.Object.extend({

		inletTypes: ['inlet'],
		outletTypes: ['outlet'],
        maxMidi: 8.17579891564 * Math.exp(.0577622650 * 1499),

        // TODO: round output ?
		message: function(inletId, msg) {
			var input = this.toFloat(msg);
			var out = 0;
			if (isNaN(input)) {
				this.patch.log("error: mtof: no method for '" + msg + "'");
			} else {
				if (input <= -1500) out = 0;
                else if (input > 1499) out = this.maxMidi;
				else out = 8.17579891564 * Math.exp(.0577622650 * input);
				this.outlets[0].message(out);
			}
		}
	});


    // Let each object know of what type it is
    var proto;
    for (type in Pd.objects) {
        if (proto = Pd.objects[type].prototype) proto.type = type;
    }

})(this.Pd);
