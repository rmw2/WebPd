var _ = require('underscore')
  , fs = require('fs')
  , path = require('path')
  , assert = require('assert')
  , helpers = require('../helpers')
  , Patch = require('../../lib/core/Patch')
  , PdObject = require('../../lib/core/PdObject')
  , portlets = require('../../lib/core/portlets')
  , pdGlob = require('../../lib/global')
  , Pd = require('../../index')
  , helpers = require('../helpers')


describe('Pd', function() {

  afterEach(function() { helpers.afterEach() })

  describe('.start', function() {

    it('should start all the patches', function() {
      var createPatch = function() {
        var patch = Pd.createPatch()
        patch.startCalled = 0
        patch.start = function() { this.startCalled++ }
        return patch
      }

      var patch1 = createPatch()
        , patch2 = createPatch()
        , patch3 = createPatch()
      assert.ok(!Pd.isStarted())
      assert.equal(patch1.startCalled, 0)
      Pd.start()
      Pd.start()
      assert.equal(patch1.startCalled, 1)
      assert.equal(patch2.startCalled, 1)
      assert.equal(patch3.startCalled, 1)
    })

  })

  describe('.stop', function() {

    it('should stop all the patches', function() {
      var createPatch = function() {
        var patch = Pd.createPatch()
        patch.stopCalled = 0
        patch.stop = function() { this.stopCalled++ }
        return patch
      }

      var patch1 = createPatch()
        , patch2 = createPatch()
        , patch3 = createPatch()
      assert.ok(!Pd.isStarted())
      assert.equal(patch1.stopCalled, 0)
      Pd.stop()
      assert.equal(patch1.stopCalled, 0)
      Pd.start()
      assert.equal(patch1.stopCalled, 0)
      Pd.stop()
      assert.equal(patch1.stopCalled, 1)
      assert.equal(patch2.stopCalled, 1)
      assert.equal(patch3.stopCalled, 1)
    })

  })

  describe('.createPatch', function() {

    it('should register the patch and give it an id', function() {
      var patch = Pd.createPatch()
      assert.ok(_.contains(_.values(pdGlob.patches), patch))
      assert.ok(_.isNumber(patch.patchId))
    })

  })

  describe('.registerAbstraction', function() {

    it('should register abstractions rightly', function() {
      var abstraction = {
        nodes: [
          {id: 0, proto: 'osc~', args: ['$1']},
          {id: 1, proto: 'outlet~'}
        ],
        connections: [
          {source: {id: 0, port: 0}, sink: {id: 1, port: 0}}
        ]
      }
      Pd.registerAbstraction('dumbOsc', abstraction)

      var patch = Pd.createPatch()
        , obj = patch.createObject('dumbOsc', [220])
        , osc = obj.objects[0]
        , outlet = obj.objects[1]

      // Check instanciated abstraction
      assert.ok(obj instanceof Patch)
      assert.equal(obj.outlets.length, 1)
      assert.equal(obj.inlets.length, 0)
      assert.equal(obj.objects.length, 2)
      
      // Check objects and connections
      assert.equal(osc.o(0).connections.length, 1)
      assert.equal(outlet.i(0).connections.length, 1)
      assert.ok(osc.o(0).connections[0] === outlet.i(0))
    })

    it('should register abstractions as string as well', function() {
      var abstractionStr = fs.readFileSync(path.join(__dirname, 'patches/dumbOsc.pd')).toString()
      Pd.registerAbstraction('dumbOsc', abstractionStr)

      var patch = Pd.createPatch()
        , obj = patch.createObject('dumbOsc', [220])
        , osc = obj.objects[0]
        , outlet = obj.objects[1]

      // Check instanciated abstraction
      assert.ok(obj instanceof Patch)
      assert.equal(obj.outlets.length, 1)
      assert.equal(obj.inlets.length, 0)
      assert.equal(obj.objects.length, 2)
      
      // Check objects and connections
      assert.equal(osc.o(0).connections.length, 1)
      assert.equal(outlet.i(0).connections.length, 1)
      assert.ok(osc.o(0).connections[0] === outlet.i(0))
    })


  })

  describe('.loadPatch', function() {
    
    it('should load a simple patch properly', function() {
      var patchStr = fs.readFileSync(__dirname + '/patches/simple.pd').toString()
        , patch = Pd.loadPatch(patchStr)
      assert.equal(patch.objects.length, 2)

      var osc = patch.objects[0]
        , dac = patch.objects[1]

      // Check objects
      assert.equal(osc.type, 'osc~')
      assert.equal(osc.frequency, 440)
      assert.equal(dac.type, 'dac~')

      // Check connections
      assert.equal(osc.o(0).connections.length, 1)
      assert.ok(osc.o(0).connections[0] === dac.i(0))
      assert.equal(dac.i(0).connections.length, 1)
      assert.equal(dac.i(1).connections.length, 0)
      assert.ok(dac.i(0).connections[0] === osc.o(0))
    })

    it('should load a patch with a subpatch properly', function() {
      var patchStr = fs.readFileSync(__dirname + '/patches/subpatch.pd').toString()
        , patch = Pd.loadPatch(patchStr)
      assert.equal(patch.objects.length, 3)

      var dac = patch.objects[0]
        , msg = patch.objects[1]
        , subpatch = patch.objects[2]

      // Check objects
      assert.equal(dac.type, 'dac~')
      assert.equal(msg.type, 'msg')
      assert.ok(subpatch instanceof Patch)

      // Check subpatch
      assert.equal(subpatch.objects.length, 3)
      var osc = subpatch.objects[0]
        , inlet = subpatch.objects[1]
        , outlet = subpatch.objects[2]
      assert.equal(osc.type, 'osc~')
      assert.equal(inlet.type, 'inlet')
      assert.equal(outlet.type, 'outlet~')
      assert.equal(osc.frequency, 330)

      // Check connections in subpatch
      assert.equal(inlet.o(0).connections.length, 1)
      assert.ok(inlet.o(0).connections[0] === osc.i(0))
      assert.equal(osc.o(0).connections.length, 1)
      assert.ok(osc.o(0).connections[0] === outlet.i(0))

      // Check connections in root patch
      assert.equal(msg.o(0).connections.length, 1)
      assert.ok(msg.o(0).connections[0] === subpatch.i(0))
      assert.equal(subpatch.o(0).connections.length, 2)
      assert.ok(subpatch.o(0).connections[0] === dac.i(0))
      assert.ok(subpatch.o(0).connections[1] === dac.i(1))
    })
    
    it('should not call object.start twice if Pd already started', function() {
      var patchStr = fs.readFileSync(__dirname + '/patches/logStartPatch.pd').toString()
        , startCalled = 0
        , logStart = PdObject.extend({
          start: function() { startCalled++ }
        })
        , patch
      pdGlob.library.logStart = logStart
      Pd.start()
      patch = Pd.loadPatch(patchStr)
      assert.equal(patch.objects.length, 1)
      assert.equal(startCalled, 1)
    })

  })

})
