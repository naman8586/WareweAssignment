import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Send, History, Trash2, Clock, X, Copy, Check, AlertCircle, RefreshCw, Loader, BarChart3 } from 'lucide-react';

function RestClient() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://jsonplaceholder.typicode.com/posts/1');
  const [headers, setHeaders] = useState('{\n "Content-Type": "application/json"\n}');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState('');
  const [statusCode, setStatusCode] = useState(null);
  const [duration, setDuration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(null);
  const ITEMS_PER_PAGE = 20;
  const observerTarget = useRef(null);
  const historyCache = useRef(new Map());

  // Compute stats from history (client-side)
  const computeStats = useCallback((historyData) => {
    if (!historyData.length) return { total: 0, avgDuration: 0, methodStats: [] };
    const total = historyData.length;
    const avgDuration = Math.round(historyData.reduce((sum, item) => sum + (item.duration || 0), 0) / total);
    const methodCounts = historyData.reduce((acc, item) => {
      acc[item.method] = (acc[item.method] || 0) + 1;
      return acc;
    }, {});
    const methodStats = Object.entries(methodCounts)
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { total, avgDuration, methodStats };
  }, []);

  // Get all request keys from localStorage
  const getRequestKeys = useCallback(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('request:')) {
        keys.push(key);
      }
    }
    return keys;
  }, []);

  // Load statistics from localStorage
  const loadStats = useCallback(async () => {
    try {
      const keys = getRequestKeys();
      if (keys.length === 0) {
        setStats({ total: 0, avgDuration: 0, methodStats: [] });
        setTotalCount(0);
        return;
      }
      // Limit to recent 100 for performance
      const recentKeys = keys.slice(-100);
      const historyData = await Promise.all(
        recentKeys.map(async (key) => {
          try {
            const itemStr = localStorage.getItem(key);
            return itemStr ? JSON.parse(itemStr) : null;
          } catch {
            return null;
          }
        })
      );
      const filteredData = historyData.filter(item => item !== null);
      const computed = computeStats(filteredData);
      setStats(computed);
      setTotalCount(keys.length); // Use full count from keys
    } catch (error) {
      console.error('Failed to load stats:', error);
      setStats({ total: 0, avgDuration: 0, methodStats: [] });
      setTotalCount(0);
    }
  }, [computeStats, getRequestKeys]);

  // Load history with pagination from localStorage
  const loadHistory = useCallback(async (pageNum = 1, append = false) => {
    const cacheKey = `page_${pageNum}`;
   
    // Check cache
    if (historyCache.current.has(cacheKey) && !append) {
      const cached = historyCache.current.get(cacheKey);
      setHistory(cached.items);
      setHasMore(cached.hasMore);
      return;
    }
    setIsLoadingHistory(true);
    try {
      const keys = getRequestKeys();
      if (keys.length === 0) {
        setHistory([]);
        setTotalCount(0);
        setHasMore(false);
        return;
      }
      // Fetch all items (since localStorage is small)
      const historyData = await Promise.all(
        keys.map(async (key) => {
          try {
            const itemStr = localStorage.getItem(key);
            return itemStr ? JSON.parse(itemStr) : null;
          } catch {
            return null;
          }
        })
      );
      const sorted = historyData
        .filter(item => item !== null)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setTotalCount(sorted.length);
      // Implement pagination
      const startIndex = (pageNum - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const paginatedItems = sorted.slice(startIndex, endIndex);
      const hasMoreItems = endIndex < sorted.length;
      // Cache the result
      historyCache.current.set(cacheKey, {
        items: paginatedItems,
        hasMore: hasMoreItems
      });
      if (append && pageNum > 1) {
        setHistory(prev => [...prev, ...paginatedItems]);
      } else {
        setHistory(paginatedItems);
      }
       
      setHasMore(hasMoreItems);
    } catch (error) {
      console.error('Failed to load history:', error);
      setHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [getRequestKeys]);

  // Initial load
  useEffect(() => {
    loadHistory(1);
    loadStats();
  }, [loadHistory, loadStats]);

  // Lazy loading with Intersection Observer
  useEffect(() => {
    if (!showHistory || !hasMore || isLoadingHistory) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          const nextPage = page + 1;
          setPage(nextPage);
          loadHistory(nextPage, true);
        }
      },
      { threshold: 0.1 }
    );
    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }
    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [showHistory, hasMore, isLoadingHistory, page, loadHistory]);

  const saveToHistory = async (requestData) => {
    try {
      const timestamp = Date.now();
      const id = timestamp;
      const itemWithId = { ...requestData, id, timestamp: new Date().toISOString() };
      localStorage.setItem(`request:${id}`, JSON.stringify(itemWithId));
     
      // Refresh history and stats
      historyCache.current.clear();
      setPage(1);
      await loadHistory(1);
      await loadStats();
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  // Make actual HTTP request directly (no proxy)
  const sendRequest = async () => {
    setLoading(true);
    setResponse('');
    setStatusCode(null);
    setDuration(null);
    const startTime = performance.now();
    try {
      // Validate headers
      let parsedHeaders = {};
      try {
        parsedHeaders = JSON.parse(headers);
      } catch {
        throw new Error('Invalid JSON in headers');
      }
      // Validate body for POST/PUT/PATCH
      let parsedBody = null;
      if (body.trim() && ['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          throw new Error('Invalid JSON in body');
        }
      }
      // Validate URL
      if (!url.trim()) {
        throw new Error('URL is required');
      }
      try {
        new URL(url);
      } catch {
        throw new Error('Invalid URL format');
      }
      // Make actual HTTP request
      const fetchOptions = {
        method,
        headers: parsedHeaders,
      };
      if (parsedBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = JSON.stringify(parsedBody);
      }
      const response = await fetch(url, fetchOptions);
      const endTime = performance.now();
      const requestDuration = Math.round(endTime - startTime);
      // Handle different response types
      const contentType = response.headers.get('content-type');
      let responseData;
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }
      const formattedResponse = typeof responseData === 'string'
        ? responseData
        : JSON.stringify(responseData, null, 2);
      setResponse(formattedResponse);
      setStatusCode(response.status);
      setDuration(requestDuration);
      // Save to history
      const historyItem = {
        method,
        url,
        headers: parsedHeaders,
        body,
        response: formattedResponse,
        statusCode: response.status,
        duration: requestDuration,
      };
      await saveToHistory(historyItem);
    } catch (error) {
      const endTime = performance.now();
      const requestDuration = Math.round(endTime - startTime);
     
      const errorResponse = JSON.stringify({
        error: error.message,
        details: 'Request failed. Check console for details.',
        type: error.name
      }, null, 2);
      setResponse(errorResponse);
      setStatusCode(error.message.includes('CORS') || error.name === 'TypeError' ? 0 : 400);
      setDuration(requestDuration);
      // Save error to history
      let parsedHeaders = {};
      try {
        parsedHeaders = JSON.parse(headers);
      } catch {}
      const historyItem = {
        method,
        url,
        headers: parsedHeaders,
        body,
        response: errorResponse,
        statusCode: 400,
        duration: requestDuration,
      };
      await saveToHistory(historyItem);
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryItem = (item) => {
    setMethod(item.method);
    setUrl(item.url);
    setHeaders(item.headers ? JSON.stringify(item.headers, null, 2) : '{}');
    setBody(item.body || '');
    setResponse(item.response || '');
    setStatusCode(item.statusCode);
    setDuration(item.duration);
    setShowHistory(false);
   
    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteHistoryItem = async (id) => {
    try {
      const key = `request:${id}`;
      localStorage.removeItem(key);
     
      // Clear cache and reload
      historyCache.current.clear();
      setPage(1);
      await loadHistory(1);
      await loadStats();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const clearAllHistory = async () => {
    try {
      const keys = getRequestKeys();
      keys.forEach(key => localStorage.removeItem(key));
     
      // Clear cache and reset
      historyCache.current.clear();
      setHistory([]);
      setTotalCount(0);
      setPage(1);
      setHasMore(false);
      await loadStats();
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  const refreshHistory = async () => {
    historyCache.current.clear();
    setPage(1);
    await loadHistory(1);
    await loadStats();
  };

  const copyResponse = () => {
    navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusColor = (status) => {
    if (status === 0) return 'text-gray-600 bg-gray-50';
    if (status >= 200 && status < 300) return 'text-green-600 bg-green-50';
    if (status >= 300 && status < 400) return 'text-blue-600 bg-blue-50';
    if (status >= 400 && status < 500) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const getStatusText = (status) => {
    if (status === 0) return 'Network Error';
    if (status >= 200 && status < 300) return 'Success';
    if (status >= 300 && status < 400) return 'Redirect';
    if (status >= 400 && status < 500) return 'Client Error';
    return 'Server Error';
  };

  const insertSampleData = (type) => {
    if (type === 'post-create') {
      setMethod('POST');
      setUrl('https://jsonplaceholder.typicode.com/posts');
      setBody('{\n "title": "New Post",\n "body": "This is my post content",\n "userId": 1\n}');
    } else if (type === 'post-get') {
      setMethod('GET');
      setUrl('https://jsonplaceholder.typicode.com/posts/1');
      setBody('');
    } else if (type === 'post-update') {
      setMethod('PUT');
      setUrl('https://jsonplaceholder.typicode.com/posts/1');
      setBody('{\n "title": "Updated Post",\n "body": "Updated content",\n "userId": 1\n}');
    } else if (type === 'post-delete') {
      setMethod('DELETE');
      setUrl('https://jsonplaceholder.typicode.com/posts/1');
      setBody('');
    } else if (type === 'users') {
      setMethod('GET');
      setUrl('https://jsonplaceholder.typicode.com/users');
      setBody('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">
          {/* Header with Stats */}
          <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 p-4 md:p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2">REST API Client</h1>
                <p className="text-indigo-100 text-sm md:text-base">Direct HTTP Requests • Local Storage • React</p>
              </div>
              <div className="flex gap-4 items-center">
                <div className="text-white">
                  <div className="text-xs md:text-sm opacity-90">Total Requests</div>
                  <div className="text-2xl md:text-3xl font-bold">{totalCount}</div>
                </div>
                <button
                  onClick={() => {
                    setShowStats(!showStats);
                    if (!stats) loadStats();
                  }}
                  className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                >
                  <BarChart3 size={24} className="text-white" />
                </button>
              </div>
            </div>
            {/* Statistics Panel */}
            {showStats && stats && (
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
                  <div className="text-white/80 text-xs">Avg Duration</div>
                  <div className="text-white text-xl font-bold">{stats.avgDuration}ms</div>
                </div>
                {stats.methodStats.map((stat) => (
                  <div key={stat.method} className="bg-white/10 rounded-lg p-3 backdrop-blur">
                    <div className="text-white/80 text-xs">{stat.method}</div>
                    <div className="text-white text-xl font-bold">{stat.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 md:p-6">
            {/* Quick Actions */}
            <div className="mb-4 p-3 md:p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-start gap-2 mb-3">
                <AlertCircle size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-bold text-blue-900 text-xs md:text-sm">Quick Test Examples</h3>
                  <p className="text-xs text-blue-700 mt-1">Direct API calls - Stored locally</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => insertSampleData('post-get')} className="px-2 md:px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700">
                  GET Post
                </button>
                <button onClick={() => insertSampleData('users')} className="px-2 md:px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700">
                  GET Users
                </button>
                <button onClick={() => insertSampleData('post-create')} className="px-2 md:px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700">
                  POST Create
                </button>
                <button onClick={() => insertSampleData('post-update')} className="px-2 md:px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-semibold hover:bg-orange-700">
                  PUT Update
                </button>
                <button onClick={() => insertSampleData('post-delete')} className="px-2 md:px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700">
                  DELETE Post
                </button>
              </div>
            </div>
            {/* Request Builder */}
            <div className="space-y-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full sm:w-auto px-3 md:px-4 py-2 md:py-3 border-2 border-gray-300 rounded-xl font-bold text-xs md:text-sm focus:ring-2 focus:ring-purple-500 bg-white"
                >
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>DELETE</option>
                  <option>PATCH</option>
                  <option>HEAD</option>
                  <option>OPTIONS</option>
                </select>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Enter request URL"
                  className="flex-1 px-3 md:px-4 py-2 md:py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-xs md:text-sm"
                />
                <button
                  onClick={sendRequest}
                  disabled={loading}
                  className="w-full sm:w-auto px-4 md:px-6 py-2 md:py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-400 flex items-center justify-center gap-2 transition-all transform hover:scale-105 disabled:scale-100 text-sm md:text-base whitespace-nowrap"
                >
                  {loading ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send size={16} className="md:w-[18px] md:h-[18px]" />
                      Send
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="w-full sm:w-auto px-4 md:px-6 py-2 md:py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-xl font-bold hover:from-gray-700 hover:to-gray-800 flex items-center justify-center gap-2 transition-all text-sm md:text-base whitespace-nowrap"
                >
                  <History size={16} className="md:w-[18px] md:h-[18px]" />
                  <span className="hidden sm:inline">History</span> ({totalCount})
                </button>
              </div>
              {/* Headers and Body */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                    Headers (JSON Format)
                  </label>
                  <textarea
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                    className="w-full h-32 md:h-40 px-3 md:px-4 py-2 md:py-3 border-2 border-gray-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                    placeholder='{"Content-Type": "application/json"}'
                  />
                </div>
                <div>
                  <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                    Request Body (JSON Format)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full h-32 md:h-40 px-3 md:px-4 py-2 md:py-3 border-2 border-gray-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                    placeholder='{"title": "Sample", "userId": 1}'
                    disabled={!['POST', 'PUT', 'PATCH'].includes(method)}
                  />
                </div>
              </div>
            </div>
            {/* Response Section */}
            {(response || loading) && (
              <div className="border-t-2 border-gray-200 pt-6 mt-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-800">Response</h2>
                  <div className="flex flex-wrap items-center gap-2 md:gap-3">
                    {statusCode !== null && (
                      <span className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-bold ${getStatusColor(statusCode)}`}>
                        {statusCode} - {getStatusText(statusCode)}
                      </span>
                    )}
                    {duration && (
                      <span className="text-xs md:text-sm text-gray-600 flex items-center gap-1 bg-gray-100 px-2 md:px-3 py-1.5 md:py-2 rounded-lg font-semibold">
                        <Clock size={14} />
                        {duration}ms
                      </span>
                    )}
                    {response && !loading && (
                      <button
                        onClick={copyResponse}
                        className="p-1.5 md:p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Copy response"
                      >
                        {copied ? <Check size={16} className="md:w-[18px] md:h-[18px] text-green-600" /> : <Copy size={16} className="md:w-[18px] md:h-[18px] text-gray-600" />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-3 md:p-4 overflow-auto max-h-64 md:max-h-96 border-2 border-gray-700">
                  <pre className="text-green-400 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                    {loading ? 'Sending real HTTP request...\n\nPlease wait...' : response}
                  </pre>
                </div>
              </div>
            )}
            {/* History Panel with Lazy Loading */}
            {showHistory && (
              <div className="border-t-2 border-gray-200 pt-6 mt-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-800">Request History</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={refreshHistory}
                      className="px-3 md:px-4 py-1.5 md:py-2 bg-blue-600 text-white rounded-lg text-xs md:text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2"
                      disabled={isLoadingHistory}
                    >
                      <RefreshCw size={14} className={`md:w-4 md:h-4 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                    {history.length > 0 && (
                      <button
                        onClick={clearAllHistory}
                        className="px-3 md:px-4 py-1.5 md:py-2 bg-red-600 text-white rounded-lg text-xs md:text-sm font-semibold hover:bg-red-700 transition-colors flex items-center gap-2"
                      >
                        <Trash2 size={14} className="md:w-4 md:h-4" />
                        Clear All
                      </button>
                    )}
                    <button
                      onClick={() => setShowHistory(false)}
                      className="p-1.5 md:p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <X size={18} className="md:w-5 md:h-5" />
                    </button>
                  </div>
                </div>
               
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {history.length === 0 && !isLoadingHistory ? (
                    <div className="text-center py-12 md:py-16 bg-gray-50 rounded-xl">
                      <History size={40} className="md:w-12 md:h-12 mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500 font-semibold text-sm md:text-base">No history yet</p>
                      <p className="text-gray-400 text-xs md:text-sm mt-2">Your API requests will appear here</p>
                    </div>
                  ) : (
                    <>
                      {history.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 md:p-4 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl hover:from-gray-100 hover:to-gray-200 transition-all border border-gray-200 gap-2"
                        >
                          <div
                            onClick={() => loadHistoryItem(item)}
                            className="flex-1 cursor-pointer w-full"
                          >
                            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                              <span className="font-bold text-purple-600 bg-purple-100 px-2 md:px-3 py-1 rounded-lg text-xs md:text-sm">
                                {item.method}
                              </span>
                              <span className="text-gray-700 truncate text-xs md:text-sm font-medium flex-1 min-w-0">
                                {item.url}
                              </span>
                              <span className={`text-xs font-bold px-2 py-1 rounded ${getStatusColor(item.statusCode)}`}>
                                {item.statusCode}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-2 flex items-center gap-2 md:gap-3 flex-wrap">
                              <span className="truncate">{new Date(item.timestamp).toLocaleString()}</span>
                              <span className="hidden sm:inline">•</span>
                              <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {item.duration}ms
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHistoryItem(item.id);
                            }}
                            className="p-1.5 md:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors self-end sm:self-auto"
                            title="Delete request"
                          >
                            <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
                          </button>
                        </div>
                      ))}
                     
                      {/* Lazy Loading Indicator */}
                      {hasMore && (
                        <div ref={observerTarget} className="text-center py-4">
                          {isLoadingHistory ? (
                            <div className="flex items-center justify-center gap-2 text-gray-500">
                              <Loader size={20} className="animate-spin" />
                              <span className="text-sm">Loading more...</span>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-400">Scroll for more</div>
                          )}
                        </div>
                      )}
                     
                      {!hasMore && history.length > 0 && (
                        <div className="text-center py-4 text-sm text-gray-400">
                          No more requests to load
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Footer */}
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              ✅ Direct HTTP Requests • Local Storage History • Client-Side Stats • No Backend Required
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RestClient;