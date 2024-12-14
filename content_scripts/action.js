const action = {
  workerStatus: null
}

const message = {
  errorsNoBacktest: 'There is no backtest data. Try to do a new backtest'
}

action.saveParameters = async () => {
  const strategyData = await tv.getStrategy(null, true)
  if(!strategyData || !strategyData.hasOwnProperty('name') || !strategyData.hasOwnProperty('properties') || !strategyData.properties) {
    await ui.showErrorPopup('The current indicator/strategy do not contain inputs that can be saved.')
    // await ui.showWarningPopup('Please open the indicator (strategy) parameters window before saving them to a file.')
    return
  }
  let strategyParamsCSV = `Name,Value\n"__indicatorName",${JSON.stringify(strategyData.name)}\n`
  Object.keys(strategyData.properties).forEach(key => {
    strategyParamsCSV += `${JSON.stringify(key)},${typeof strategyData.properties[key][0] === 'string' ? JSON.stringify(strategyData.properties[key]) : strategyData.properties[key]}\n`
  })
  file.saveAs(strategyParamsCSV, `${strategyData.name}.csv`)
}

action.loadParameters = async () => {
  await file.upload(file.uploadHandler, '', false)
}

action.uploadSignals = async () => {
  await file.upload(signal.parseTSSignalsAndGetMsg, `Please check if the ticker and timeframe are set like in the downloaded data and click on the parameters of the "iondvSignals" script to automatically enter new data on the chart.`, true)
}

action.uploadStrategyTestParameters = async () => {
  await file.upload(model.parseStrategyParamsAndGetMsg, '', false)
}

action.getStrategyTemplate = async () => {
  const strategyData = await tv.getStrategy()
  if(!strategyData || !strategyData.hasOwnProperty('name') || !strategyData.hasOwnProperty('properties') || !strategyData.properties) {
    await ui.showErrorPopup('The current strategy do not contain inputs, than can be saved')
  } else {
    const paramRange = model.getStrategyRange(strategyData)
    console.log(paramRange)
    // await storage.setKeys(storage.STRATEGY_KEY_PARAM, paramRange)
    const strategyRangeParamsCSV = model.convertStrategyRangeToTemplate(paramRange)
    await ui.showPopup('The range of parameters is saved for the current strategy.\n\nYou can start optimizing the strategy parameters by clicking on the "Test strategy" button')
    file.saveAs(strategyRangeParamsCSV, `${strategyData.name}.csv`)
  }
}

action.clearAll = async () => {
  const clearRes = await storage.clearAll()
  await ui.showPopup(clearRes && clearRes.length ? `The data was deleted: \n${clearRes.map(item => '- ' + item).join('\n')}` : 'There was no data in the storage')
}

action.previewStrategyTestResults = async () => {
  const testResults = await storage.getKey(storage.STRATEGY_KEY_RESULTS)
  if(!testResults || (!testResults.perfomanceSummary && !testResults.perfomanceSummary.length)) {
    await ui.showWarningPopup(message.errorsNoBacktest)
    return
  }
  console.log('previewStrategyTestResults', testResults)
  const eventData = await sendActionMessage(testResults, 'previewStrategyTestResults')
  if (eventData.hasOwnProperty('message'))
    await ui.showPopup(eventData.message)

  // await ui.showPreviewResults(previewResults) // WHY NOT WORKING ?
}

action.downloadStrategyTestResults = async () => {
  const testResults = await storage.getKey(storage.STRATEGY_KEY_RESULTS)
  if(!testResults || (!testResults.perfomanceSummary && !testResults.perfomanceSummary.length)) {
    await ui.showWarningPopup(message.errorsNoBacktest)
    return
  }
  testResults.optParamName = testResults.optParamName || backtest.DEF_MAX_PARAM_NAME
  console.log('downloadStrategyTestResults', testResults)
  const CSVResults = file.convertResultsToCSV(testResults)
  const bestResult = testResults.perfomanceSummary ? model.getBestResult(testResults) : {}
  const propVal = {}
  testResults.paramsNames.forEach(paramName => {
    if(bestResult.hasOwnProperty(`__${paramName}`))
      propVal[paramName] = bestResult[`__${paramName}`]
  })
  await tv.setStrategyParams(testResults.shortName, propVal)
  if(bestResult && bestResult.hasOwnProperty(testResults.optParamName))
    await ui.showPopup(`The best found parameters are set for the strategy\n\nThe best ${testResults.isMaximizing ? '(max) ':'(min)'} ${testResults.optParamName}: ` + bestResult[testResults.optParamName])
  file.saveAs(CSVResults, `${testResults.ticker}:${testResults.timeFrame} ${testResults.shortName} - ${testResults.cycles}_${testResults.isMaximizing ? 'max':'min'}_${testResults.optParamName}_${testResults.method}.csv`)
}

action.groupStrategy = async (request, isDeepTest = false) => {
  try {
    const strategyData = await action._getStrategyData()
    const groupsParams = await action._getGroupRangeParams(strategyData)

    if(groupsParams.length > 0) {

      let bestValue = null

      for (let index = 0; index < groupsParams.length; index++) {
        const {allRangeParams, paramRange, cycles} = groupsParams[index];

        if(allRangeParams !== null) { // click cancel on parameters
          const strategyData = await action._getStrategyData()
          const testParams = await action._getTestParams(request, strategyData, allRangeParams, paramRange, cycles)
          testParams.shouldSkipInitBestResult = true
          console.log('Test parameters', testParams)
          action._showStartMsg(testParams.paramSpace, testParams.cycles, testParams.backtestDelay ? `with delay between tests ${testParams.backtestDelay} sec` : ``, index + 1, groupsParams.length)
          testParams.isDeepTest = isDeepTest
          await tv.setDeepTest(isDeepTest, testParams.deepStartDate)

          let testResults = {}

          if(testParams.hasOwnProperty('bestPropVal'))
            delete testParams.bestPropVal
          if(testParams.hasOwnProperty('bestValue'))
            delete testParams.bestValue
          testResults = await backtest.testStrategy(testParams, strategyData, allRangeParams) // TODO think about not save, but store them from  testResults.perfomanceSummary, testResults.filteredSummary = [], testResults.timeFrame to list
          await action._saveTestResults(testResults, testParams, false, true)
          if (bestValue === null) {
            bestValue = testResults.bestValue
          } else if (testResults.isMaximizing ? testParams.bestValue > bestValue : testParams.bestValue < bestValue) {
            bestValue = testResults.bestValue
          }
          if (action.workerStatus === null) {
            console.log('Stop command detected')
            break
          }
        }
      }

      if (bestValue !== null) {
        await ui.showPopup(`The best value ${bestValue}. Check the saved files to get the best result parameters`)
      } else {
        await ui.showWarningPopup(`Did not found any result value after testing`)
      }

      if (isDeepTest)
        await tv.setDeepTest(!isDeepTest) // Reverse (switch off)
    }
    else {
      await ui.showWarningPopup(`You set group is empty`)
    }

  } catch (err) {
    console.error(err)
    await ui.showErrorPopup(`${err}`)
  }
  ui.statusMessageRemove()
}

action._getGroupRangeParams = async (strategyData) => {
  const group = 5;
  // const groupsParams = [];
  // TODO(keien): groupsParams自定义
  const groupsParams = [
    {
      "allRangeParams": {
        "ADX Length": [
          10,
          12,
          14,
          16,
          18,
          20,
          22,
          24,
          26,
          28,
          30,
          32,
          34,
          36,
          38,
          40,
          42,
          44,
          46,
          48,
          50,
          52,
          54,
          56
        ],
        "ADX Smoothing": [
          2,
          4,
          6,
          8,
          10,
          12,
          14,
          16,
          18,
          20
        ],
        "ADX Threshold": [
          10,
          12,
          14,
          16,
          18,
          20,
          22,
          24,
          26,
          28,
          30,
          32,
          34,
          36,
          38,
          40,
          42,
          44,
          46
        ]
      },
      "paramRange": {
        "ADX Length": [
          10,
          56,
          2,
          28,
          4
        ],
        "ADX Smoothing": [
          2,
          20,
          2,
          10,
          5
        ],
        "ADX Threshold": [
          10,
          46,
          2,
          23,
          6
        ]
      },
      "cycles": 1000
    },
    {
      "allRangeParams": {
        "Slow EMA Length": [
          40,
          60,
          80,
          100,
          120,
          140,
          160,
          180,
          200,
          220,
          240,
          260,
          280,
          300,
          320,
          340,
          360,
          380,
          400,
          420,
          440,
          460,
          480,
          500,
          520,
          540,
          560,
          580,
          600,
          620,
          640,
          660,
          680,
          700,
          720,
          740,
          760,
          780,
          800
        ],
        "Fast EMA Length": [
          20,
          25,
          30,
          35,
          40,
          45,
          50,
          55,
          60,
          65,
          70,
          75,
          80,
          85,
          90,
          95,
          100,
          105,
          110,
          115,
          120,
          125,
          130,
          135,
          140,
          145,
          150,
          155,
          160,
          165,
          170,
          175,
          180,
          185,
          190,
          195,
          200,
          205,
          210,
          215,
          220,
          225,
          230,
          235,
          240,
          245,
          250,
          255,
          260,
          265,
          270,
          275,
          280,
          285,
          290,
          295,
          300,
          305,
          310,
          315,
          320,
          325,
          330,
          335,
          340,
          345,
          350,
          355,
          360,
          365,
          370,
          375,
          380,
          385,
          390,
          395,
          400
        ]
      },
      "paramRange": {
        "Slow EMA Length": [
          40,
          800,
          20,
          775,
          2
        ],
        "Fast EMA Length": [
          20,
          400,
          5,
          125,
          3
        ]
      },
      "cycles": 1000
    },
    {
      "allRangeParams": {
        "SAR star": [
          0.01,
          0.02,
          0.03,
          0.04,
          0.05,
          0.06,
          0.07,
          0.08,
          0.09,
          0.1,
          0.11,
          0.12,
          0.13,
          0.14,
          0.15,
          0.16
        ],
        "SAR inc": [
          0.01,
          0.02,
          0.03,
          0.04,
          0.05,
          0.06,
          0.07,
          0.08
        ],
        "SAR max": [
          0.1,
          0.2,
          0.3,
          0.4,
          0.5,
          0.6,
          0.7,
          0.8
        ]
      },
      "paramRange": {
        "SAR star": [
          0.01,
          0.16,
          0.01,
          0.08,
          7
        ],
        "SAR inc": [
          0.01,
          0.08,
          0.01,
          0.04,
          8
        ],
        "SAR max": [
          0.1,
          0.8,
          0.1,
          0.4,
          9
        ]
      },
      "cycles": 300
    },
    {
      "allRangeParams": {
        "MACD Fast MA Length": [
          10,
          12,
          14,
          16,
          18,
          20,
          22,
          24,
          26,
          28,
          30,
          32,
          34,
          36,
          38,
          40,
          42,
          44,
          46,
          48
        ],
        "MACD Slow MA Length": [
          20,
          28,
          36,
          44,
          52,
          60,
          68,
          76,
          84,
          92,
          100,
          108
        ],
        "MACD Signal Length": [
          4,
          6,
          8,
          10,
          12,
          14,
          16,
          18,
          20,
          22,
          24,
          26,
          28
        ]
      },
      "paramRange": {
        "MACD Fast MA Length": [
          10,
          48,
          2,
          24,
          11
        ],
        "MACD Slow MA Length": [
          20,
          108,
          8,
          54,
          12
        ],
        "MACD Signal Length": [
          4,
          28,
          2,
          14,
          13
        ]
      },
      "cycles": 1000
    },
    {
      "allRangeParams": {
        "BB Length": [
          20,
          30,
          40,
          50,
          60,
          70,
          80
        ],
        "BB Multiplier": [
          1,
          2,
          3,
          4,
          5
        ],
        "Min. BB Width % (New Position)": [
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10
        ],
        "Min. BB Width % (Pyramiding)": [
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10
        ]
      },
      "paramRange": {
        "BB Length": [
          20,
          80,
          10,
          40,
          20
        ],
        "BB Multiplier": [
          1,
          5,
          1,
          2,
          21
        ],
        "Min. BB Width % (New Position)": [
          1,
          10,
          1,
          5,
          22
        ],
        "Min. BB Width % (Pyramiding)": [
          1,
          10,
          1,
          2,
          23
        ]
      },
      "cycles": 1000
    }
  ];
  console.log('groupsParams', groupsParams)
  return groupsParams;
  for (let index = 0; index < group; index++){
    const [allRangeParams, paramRange, cycles] = await action._getRangeParams(strategyData)
    groupsParams.push({'allRangeParams':allRangeParams, 'paramRange':paramRange, 'cycles':cycles});
  }
  console.log('groupsParams', groupsParams)
  return groupsParams;
}

action.testStrategy = async (request, isDeepTest = false) => {
  try {
    const strategyData = await action._getStrategyData()
    const [allRangeParams, paramRange, cycles] = await action._getRangeParams(strategyData)
    if(allRangeParams !== null) { // click cancel on parameters
      const testParams = await action._getTestParams(request, strategyData, allRangeParams, paramRange, cycles)
      console.log('Test parameters', testParams)
      action._showStartMsg(testParams.paramSpace, testParams.cycles, testParams.backtestDelay ? ` with delay between tests ${testParams.backtestDelay} sec` : '')
      testParams.isDeepTest = isDeepTest
      await tv.setDeepTest(isDeepTest, testParams.deepStartDate)

      let testResults = {}
      if (testParams.shouldTestTF) {
        if (!testParams.listOfTF || testParams.listOfTF.length === 0) {
          await ui.showWarningPopup(`You set to test timeframes in options, but timeframes list after correction values is empty: ${testParams.listOfTFSource}\nPlease set correct one with separation by comma. \nFor example: 1m,4h`)
        } else {
          let bestValue = null
          let bestTf = null
          testParams.shouldSkipInitBestResult = true
          for (const tf of testParams.listOfTF) {
            console.log('\nTest timeframe:', tf)
            await tvChart.changeTimeFrame(tf)
            testParams.timeFrame = tf
            if(testParams.hasOwnProperty('bestPropVal'))
              delete testParams.bestPropVal
            if(testParams.hasOwnProperty('bestValue'))
              delete testParams.bestValue
            testResults = await backtest.testStrategy(testParams, strategyData, allRangeParams) // TODO think about not save, but store them from  testResults.perfomanceSummary, testResults.filteredSummary = [], testResults.timeFrame to list
            await action._saveTestResults(testResults, testParams, false)
            if (bestTf === null) {
              bestValue = testResults.bestValue
              bestTf = tf
            } else if (testResults.isMaximizing ? testParams.bestValue > bestValue : testParams.bestValue < bestValue) {
              bestValue = testResults.bestValue
              bestTf = tf
            }
            if (action.workerStatus === null) {
              console.log('Stop command detected')
              break
            }
          }
          if (bestValue !== null) {
            await ui.showPopup(`The best value ${bestValue} for timeframe ${bestTf}. Check the saved files to get the best result parameters`)
          } else {
            await ui.showWarningPopup(`Did not found any result value after testing`)
          }
        }
      } else {
        testResults = await backtest.testStrategy(testParams, strategyData, allRangeParams)
        await action._saveTestResults(testResults, testParams)
      }
      if (isDeepTest)
        await tv.setDeepTest(!isDeepTest) // Reverse (switch off)
    }
  } catch (err) {
    console.error(err)
    await ui.showErrorPopup(`${err}`)
  }
  ui.statusMessageRemove()
}

action._getRangeParams = async (strategyData) => {
  let paramRange = await model.getStrategyParameters(strategyData)
  console.log('paramRange', paramRange)
  if(paramRange === null)
    // throw new Error('Error get changed strategy parameters')
    return [null, null, null]

  const initParams = {}
  initParams.paramRange = paramRange
  // initParams.paramRangeSrc = model.getStrategyRange(strategyData)
  // TODO(keien): paramRangeSrc 自定义
  initParams.paramRangeSrc = {
    "Long / Short": [
      "Both;Long;Short;",
      "",
      0,
      "Both",
      1
    ],
    "Slow EMA Length": [
      40,
      800,
      20,
      775,
      2
    ],
    "Fast EMA Length": [
      20,
      400,
      5,
      125,
      3
    ],
    "ADX Length": [
      10,
      56,
      2,
      28,
      4
    ],
    "ADX Smoothing": [
      2,
      20,
      2,
      10,
      5
    ],
    "ADX Threshold": [
      10,
      46,
      2,
      23,
      6
    ],
    "SAR star": [
      0.01,
      0.16,
      0.01,
      0.08,
      7
    ],
    "SAR inc": [
      0.01,
      0.08,
      0.01,
      0.04,
      8
    ],
    "SAR max": [
      0.1,
      0.8,
      0.1,
      0.4,
      9
    ],
    "MACD OPTION": [
      "MAC-Z;MACD;",
      "",
      0,
      "MAC-Z",
      10
    ],
    "MACD Fast MA Length": [
      10,
      48,
      2,
      24,
      11
    ],
    "MACD Slow MA Length": [
      20,
      108,
      8,
      54,
      12
    ],
    "MACD Signal Length": [
      4,
      28,
      2,
      14,
      13
    ],
    "Z-VWAP Length": [
      7,
      28,
      2,
      14,
      14
    ],
    "StDev Length": [
      5,
      22,
      2,
      11,
      15
    ],
    "MAC-Z constant A": [
      0.05,
      0.2,
      1,
      0.1,
      16
    ],
    "MAC-Z constant B": [
      0,
      2,
      1,
      1,
      17
    ],
    "Volume Factor": [
      0.55,
      2.2,
      1,
      1.1,
      18
    ],
    "SMA Volume Length": [
      44,
      178,
      13,
      89,
      19
    ],
    "BB Length": [
      20,
      80,
      10,
      40,
      20
    ],
    "BB Multiplier": [
      1,
      5,
      1,
      2,
      21
    ],
    "Min. BB Width % (New Position)": [
      1,
      10,
      1,
      5,
      22
    ],
    "Min. BB Width % (Pyramiding)": [
      1,
      10,
      1,
      2,
      23
    ],
    "Take Profit Option": [
      "Both;Normal;Donchian;",
      "",
      0,
      "Both",
      24
    ],
    "Take Profit %": [
      2,
      8,
      1,
      4,
      25
    ],
    "Trail offset %": [
      0.05,
      0.2,
      1,
      0.1,
      26
    ],
    "Donchian Channel Period": [
      52,
      208,
      16,
      104,
      27
    ],
    "Stop Loss Option": [
      "Both;Normal;ATR;",
      "",
      0,
      "Both",
      28
    ],
    "Stop Loss %": [
      3,
      12,
      1,
      6,
      29
    ],
    "ATR Period": [
      7,
      28,
      2,
      14,
      30
    ],
    "ATR Multiplier": [
      9,
      36,
      3,
      18,
      31
    ],
    "Max. Risk %": [
      2,
      10,
      1,
      5,
      32
    ],
    "Max. Pyramiding": [
      1,
      6,
      1,
      3,
      33
    ],
    "Step Entry Mode": [
      "Incremental;Normal;",
      "",
      0,
      "Incremental",
      34
    ],
    "Min. Better Price %": [
      0.55,
      2.2,
      1,
      1.1,
      35
    ],
    "Lever": [
      1,
      6,
      1,
      3,
      36
    ]
  };
  console.log('_getRangeParams initParams', initParams)
  const changedStrategyParams = await ui.showAndUpdateStrategyParameters(initParams)
  if(changedStrategyParams === null) {
    return [null, null, null]
  }
  const cycles = changedStrategyParams.cycles ? changedStrategyParams.cycles : 100
  console.log('changedStrategyParams', changedStrategyParams)
  if (changedStrategyParams.paramRange === null) {
    console.log('Don not change paramRange')
  } else if (typeof changedStrategyParams.paramRange === 'object' && Object.keys(changedStrategyParams.paramRange).length) {
    paramRange = changedStrategyParams.paramRange
    await model.saveStrategyParameters(paramRange)
    console.log('ParamRange changes to', paramRange)
  } else {
    throw new Error ('The strategy parameters invalid. Change them or run default parameters set.')
  }

  const allRangeParams = model.createParamsFromRange(paramRange)
  console.log('allRangeParams', allRangeParams)
  if(!allRangeParams) {
    throw new Error ('Empty range parameters for strategy')
  }
  return [allRangeParams, paramRange, cycles]
}

action._getStrategyData = async () => {
  ui.statusMessage('Get the initial parameters.')
  const strategyData = await tv.getStrategy()
  if(!strategyData || !strategyData.hasOwnProperty('name') || !strategyData.hasOwnProperty('properties') || !strategyData.properties) {
    throw new Error('The current strategy do not contain inputs, than can be optimized. You can choose another strategy to optimize.')
  }
  return strategyData
}


action._parseTF = (listOfTF) => {
  if (!listOfTF || typeof (listOfTF) !== 'string')
    return []
  return listOfTF.split(',').map(tf => tf.trim()).filter(tf => /(^\d{1,2}m$)|(^\d{1,2}h$)|(^\d{1,2}D$)|(^\d{1,2}W$)|(^\d{1,2}M$)/.test(tf))

}

action._getTestParams = async (request, strategyData, allRangeParams, paramRange, cycles) => {
  let testParams = await tv.switchToStrategyTab()
  const options = request && request.hasOwnProperty('options') ? request.options : {  }
  const testMethod = options.hasOwnProperty('optMethod') && typeof (options.optMethod) === 'string' ? options.optMethod.toLowerCase() : 'random'
  let paramSpaceNumber = 0
  let isSequential = false
  if(['sequential'].includes(testMethod)) {
    paramSpaceNumber = Object.keys(allRangeParams).reduce((sum, param) => sum += allRangeParams[param].length, 0)
    isSequential = true
  } else {
    paramSpaceNumber = Object.keys(allRangeParams).reduce((mult, param) => mult *= allRangeParams[param].length, 1)
  }
  console.log('paramSpaceNumber', paramSpaceNumber)

  testParams.shouldTestTF = options.hasOwnProperty('shouldTestTF') ? options.shouldTestTF : false
  testParams.listOfTF = action._parseTF(options.listOfTF)
  testParams.listOfTFSource = options.listOfTF
  testParams.shouldSkipInitBestResult = false // TODO get from options

  testParams.paramSpace = paramSpaceNumber
  let paramPriority = model.getParamPriorityList(paramRange) // Filter by allRangeParams
  paramPriority = paramPriority.filter(key => allRangeParams.hasOwnProperty(key))
  console.log('paramPriority list', paramPriority)
  testParams.paramPriority = paramPriority

  testParams.startParams = await model.getStartParamValues(paramRange, strategyData)
  console.log('testParams.startParams', testParams.startParams)
  if(!testParams.hasOwnProperty('startParams') || !testParams.startParams.hasOwnProperty('current') || !testParams.startParams.current) {
    throw new Error('Error.\n\n The current strategy parameters could not be determined.\n Testing aborted')
  }

  testParams.cycles = cycles


  if(request.options) {
    testParams.isMaximizing = request.options.hasOwnProperty('isMaximizing') ? request.options.isMaximizing : true
    testParams.optParamName =  request.options.optParamName ? request.options.optParamName : backtest.DEF_MAX_PARAM_NAME
    testParams.method = testMethod
    testParams.filterAscending = request.options.hasOwnProperty('optFilterAscending') ? request.options.optFilterAscending : null
    testParams.filterValue = request.options.hasOwnProperty('optFilterValue') ? request.options.optFilterValue : 50
    testParams.filterParamName = request.options.hasOwnProperty('optFilterParamName') ? request.options.optFilterParamName : 'Total Closed Trades: All'
    testParams.deepStartDate = !request.options.hasOwnProperty('deepStartDate') || request.options['deepStartDate'] === '' ? null : request.options['deepStartDate']
    testParams.backtestDelay = !request.options.hasOwnProperty('backtestDelay') || !request.options['backtestDelay'] ? 0 : request.options['backtestDelay']
    testParams.randomDelay = request.options.hasOwnProperty('randomDelay') ? Boolean(request.options['randomDelay']) : true
    testParams.shouldSkipInitBestResult = request.options.hasOwnProperty('shouldSkipInitBestResult') ? Boolean(request.options['shouldSkipInitBestResult']) : false
    testParams.shouldSkipWaitingForDownload = request.options.hasOwnProperty('shouldSkipWaitingForDownload') ? Boolean(request.options['shouldSkipWaitingForDownload']) : false
    testParams.dataLoadingTime = request.options.hasOwnProperty('dataLoadingTime') && !isNaN(parseInt(request.options['dataLoadingTime'])) ? request.options['dataLoadingTime'] :30
  }
  return testParams
}

action._showStartMsg = (paramSpaceNumber, cycles, addInfo, groupCurrent = 1, maxGroup = 1) => {
  let extraHeader = `Group: ${groupCurrent}/${maxGroup}, The search is performed among ${paramSpaceNumber} possible combinations of parameters (space).`
  extraHeader += (paramSpaceNumber/cycles) > 10 ? `<br />This is too large for ${cycles} cycles. It is recommended to use up to 3-4 essential parameters, remove the rest from the strategy parameters file.` : ''
  ui.statusMessage(`Started${addInfo}.`, extraHeader)
}

action._saveTestResults = async (testResults, testParams, isFinalTest = true, isGroup = false) => {
  console.log('testResults', testResults)
  if(!testResults.perfomanceSummary && !testResults.perfomanceSummary.length) {
    await ui.showWarningPopup('There is no testing data for saving. Try to do test again')
    return
  }

  const CSVResults = file.convertResultsToCSV(testResults)
  const bestResult = testResults.perfomanceSummary ? model.getBestResult(testResults) : {}
  const initBestValue = testResults.hasOwnProperty('initBestValue') ? testResults.initBestValue : null
  const propVal = {}
  testResults.paramsNames.forEach(paramName => {
    if(bestResult.hasOwnProperty(`__${paramName}`))
      propVal[paramName] = bestResult[`__${paramName}`]
  })
  if (isFinalTest || isGroup)
    console.log(`setStrategyParams testResults.shortName:${testResults.shortName}, propVal:${propVal}`)
    await tv.setStrategyParams(testResults.shortName, propVal)
  let text = `All done.\n\n`
  text += bestResult && bestResult.hasOwnProperty(testParams.optParamName) ? 'The best '+ (testResults.isMaximizing ? '(max) ':'(min) ') + testParams.optParamName + ': ' + backtest.convertValue(bestResult[testParams.optParamName]) : ''
  text += (initBestValue !== null && bestResult && bestResult.hasOwnProperty(testParams.optParamName) && initBestValue === bestResult[testParams.optParamName]) ? `\nIt isn't improved from the initial value: ${backtest.convertValue(initBestValue)}` : ''
  ui.statusMessage(text)
  console.log(`All done.\n\n${bestResult && bestResult.hasOwnProperty(testParams.optParamName) ? 'The best ' + (testResults.isMaximizing ? '(max) ':'(min) ')  + testParams.optParamName + ': ' + bestResult[testParams.optParamName] : ''}`)
  if(testParams.shouldSkipWaitingForDownload || !isFinalTest)
    file.saveAs(CSVResults, `${testResults.ticker}:${testResults.timeFrame}${testResults.isDeepTest ? ' deep backtesting' : ''} ${testResults.shortName} - ${testResults.cycles}_${testResults.isMaximizing ? 'max':'min'}_${testResults.optParamName}_${testResults.method}.csv`)
  if (isFinalTest) {
    if(!isGroup) {
      await ui.showPopup(text)
    }
    if(!testParams.shouldSkipWaitingForDownload)
       file.saveAs(CSVResults, `${testResults.ticker}:${testResults.timeFrame}${testResults.isDeepTest ? ' deep backtesting' : ''} ${testResults.shortName} - ${testResults.cycles}_${testResults.isMaximizing ? 'max':'min'}_${testResults.optParamName}_${testResults.method}.csv`)
  }
}


action.show3DChart = async () => {
  const testResults = await storage.getKey(storage.STRATEGY_KEY_RESULTS)
  if(!testResults || (!testResults.perfomanceSummary && !testResults.perfomanceSummary.length)) {
    await ui.showPopup('There is no results data for to show. Try to backtest again')
    return
  }
  testResults.optParamName = testResults.optParamName || backtest.DEF_MAX_PARAM_NAME
  const eventData = await sendActionMessage(testResults, 'show3DChart')
  if (eventData.hasOwnProperty('message'))
    await ui.showPopup(eventData.message)
}

async function sendActionMessage(data, action) {
  return new Promise(resolve => {
    const url =  window.location && window.location.origin ? window.location.origin : 'https://www.tradingview.com'
    tvPageMessageData[action] = resolve
    window.postMessage({name: 'iondvScript', action, data}, url) // TODO wait for data
  })
}