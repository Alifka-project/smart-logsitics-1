import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Download, Filter, Calendar, FileText, ChevronDown, ChevronUp, Package, MapPin, Phone, User, Clock, Image, ArrowRight } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
}

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#6b7280'];

export default function AdminReportsPage() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Last 30 days
    endDate: new Date().toISOString().split('T')[0],
    status: '',
    customerStatus: '', // New filter for customer response status
    poNumber: ''
  });
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  useEffect(() => {
    ensureAuth();
    loadReport();
  }, []);

  const loadReport = async (exportFormat = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      // Note: status, customerStatus, and poNumber filters are applied client-side
      if (exportFormat) params.append('format', exportFormat);

      if (exportFormat === 'csv') {
        // Handle CSV download using fetch directly
        const token = localStorage.getItem('auth_token');
        const clientKey = localStorage.getItem('client_key');
        // Use relative URLs for production (same domain), or VITE_API_URL if set
        const apiUrl = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/admin/reports` : `/api/admin/reports`;
        const response = await fetch(`${apiUrl}?${params.toString()}`, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'X-Client-Key': clientKey || '',
          }
        });
        
        if (!response.ok) throw new Error('Failed to download CSV');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `deliveries-report-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setLoading(false);
      } else {
        const response = await api.get(`/admin/reports?${params.toString()}`);
        setReportData(response.data);
        setLoading(false);
      }
    } catch (e) {
      console.error('Error loading report:', e);
      alert('Failed to load report: ' + (e?.response?.data?.error || e.message));
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    // Reset to first page when filters change
    setCurrentPage(1);
  };

  const handleExportCSV = () => {
    loadReport('csv');
  };

  // Get customer status from delivery
  const getCustomerStatus = (delivery) => {
    const status = (delivery.status || '').toLowerCase();
    if (status === 'scheduled-confirmed') return 'Accepted';
    if ((status === 'cancelled' || status === 'canceled' || status === 'rejected') && 
        (delivery.actor_type === 'customer' || delivery.cancelled_by === 'customer')) {
      return 'Cancelled';
    }
    if (status === 'rescheduled' && (delivery.actor_type === 'customer' || delivery.rescheduled_by === 'customer')) {
      return 'Rescheduled';
    }
    return 'Pending';
  };

  // Filter deliveries by status, customer response, and PO number
  const filteredDeliveries = useMemo(() => {
    if (!reportData?.deliveries) return [];
    
    let filtered = [...reportData.deliveries];
    
    // Apply delivery status filter
    if (filters.status) {
      filtered = filtered.filter(delivery => {
        const deliveryStatus = (delivery.status || '').toLowerCase();
        return deliveryStatus === filters.status.toLowerCase();
      });
    }
    
    // Apply customer status filter
    if (filters.customerStatus) {
      filtered = filtered.filter(delivery => {
        const customerStatus = getCustomerStatus(delivery);
        return customerStatus.toLowerCase() === filters.customerStatus.toLowerCase();
      });
    }
    
    // Apply PO number filter (search/contains)
    if (filters.poNumber) {
      const searchTerm = filters.poNumber.toLowerCase().trim();
      filtered = filtered.filter(delivery => {
        const poNumber = (delivery.poNumber || delivery.PONumber || '').toLowerCase();
        return poNumber.includes(searchTerm);
      });
    }
    
    return filtered;
  }, [reportData?.deliveries, filters.status, filters.customerStatus, filters.poNumber]);

  // Sort deliveries
  const sortedDeliveries = useMemo(() => {
    if (!sortConfig.key) return filteredDeliveries;
    
    const sorted = [...filteredDeliveries].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];
      
      // Handle nested properties
      if (sortConfig.key === 'customer') {
        aValue = a.customer || a.Customer || '';
        bValue = b.customer || b.Customer || '';
      } else if (sortConfig.key === 'address') {
        aValue = a.address || a.Address || '';
        bValue = b.address || b.Address || '';
      } else if (sortConfig.key === 'createdAt') {
        aValue = new Date(a.created_at || a.createdAt || a.created || 0);
        bValue = new Date(b.created_at || b.createdAt || b.created || 0);
      }
      
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [filteredDeliveries, sortConfig]);

  // Paginate deliveries
  const paginatedDeliveries = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedDeliveries.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedDeliveries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedDeliveries.length / itemsPerPage);

  const handleSort = (key) => {
    setSortConfig(prevConfig => {
      if (prevConfig.key === key) {
        return {
          key,
          direction: prevConfig.direction === 'asc' ? 'desc' : 'asc'
        };
      }
      return { key, direction: 'asc' };
    });
  };

  const getStatusColor = (status) => {
    const s = (status || '').toLowerCase();
    if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) {
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
    }
    if (['cancelled', 'canceled', 'rejected'].includes(s)) {
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    }
    if (s === 'rescheduled') {
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
    }
    if (['scheduled', 'scheduled-confirmed'].includes(s)) {
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
    }
    if (['out-for-delivery', 'in-progress'].includes(s)) {
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300';
    }
    return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
  };

  const getCustomerStatusColor = (status) => {
    const s = status.toLowerCase();
    if (s === 'accepted') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
    if (s === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    if (s === 'rescheduled') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
    return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
  };

  if (!reportData && !loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No report data available</p>
        </div>
      </div>
    );
  }

  const stats = reportData?.stats || {};
  const dailyBreakdown = reportData?.dailyBreakdown || [];
  const statusDistribution = reportData?.statusDistribution || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Reports & Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generated: {reportData?.generatedAt ? new Date(reportData.generatedAt).toLocaleString() : 'N/A'}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/admin/reports/pod"
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
          >
            <Image className="w-4 h-4" />
            POD Report
            <ArrowRight className="w-4 h-4" />
          </Link>
          <button
            onClick={handleExportCSV}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => loadReport()}
            disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Filters</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Delivery Status</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Delivery Statuses</option>
              <option value="delivered">Delivered</option>
              <option value="delivered-with-installation">Delivered (With Installation)</option>
              <option value="delivered-without-installation">Delivered (Without Installation)</option>
              <option value="pending">Pending</option>
              <option value="scheduled">Scheduled</option>
              <option value="scheduled-confirmed">Scheduled Confirmed</option>
              <option value="out-for-delivery">Out for Delivery</option>
              <option value="in-progress">In Progress</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer Response</label>
            <select
              value={filters.customerStatus}
              onChange={(e) => handleFilterChange('customerStatus', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Customer Statuses</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PO Number</label>
            <input
              type="text"
              value={filters.poNumber}
              onChange={(e) => handleFilterChange('poNumber', e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => loadReport()}
            disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            Apply Filters
          </button>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing {filteredDeliveries.length} delivery{filteredDeliveries.length !== 1 ? 'ies' : ''}
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Deliveries" value={stats.total} color="blue" />
        <StatCard label="Delivered" value={stats.delivered} color="green" subtitle={`${stats.successRate}% success rate`} />
        <StatCard label="Cancelled" value={stats.cancelled} color="red" subtitle={`${stats.cancellationRate}% cancellation rate`} />
        <StatCard label="Pending" value={stats.pending} color="yellow" />
      </div>

      {/* Customer Response Statistics */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Customer Response Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard 
            label="Customer Accepted" 
            value={stats.customerAccepted || 0} 
            color="green" 
            subtitle={`${stats.total > 0 ? ((stats.customerAccepted / stats.total) * 100).toFixed(1) : 0}% acceptance rate`} 
          />
          <StatCard 
            label="Customer Cancelled" 
            value={stats.customerCancelled || 0} 
            color="red" 
            subtitle={`${stats.total > 0 ? ((stats.customerCancelled / stats.total) * 100).toFixed(1) : 0}% cancellation rate`} 
          />
          <StatCard 
            label="Customer Rescheduled" 
            value={stats.customerRescheduled || 0} 
            color="yellow" 
            subtitle={`${stats.total > 0 ? ((stats.customerRescheduled / stats.total) * 100).toFixed(1) : 0}% reschedule rate`} 
          />
        </div>
      </div>

      {/* POD (Proof of Delivery) Statistics */}
      {stats.delivered > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Proof of Delivery (POD) Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard 
              label="Deliveries with POD" 
              value={stats.withPOD || 0} 
              color="green" 
              subtitle={`${stats.delivered > 0 ? ((stats.withPOD / stats.delivered) * 100).toFixed(1) : 0}% of delivered deliveries`} 
            />
            <StatCard 
              label="Deliveries without POD" 
              value={stats.withoutPOD || 0} 
              color="red" 
              subtitle={`${stats.delivered > 0 ? ((stats.withoutPOD / stats.delivered) * 100).toFixed(1) : 0}% of delivered deliveries`} 
            />
          </div>
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <strong>POD includes:</strong> Driver signature, Customer signature, or Delivery photos
            </p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Daily Breakdown</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
              <XAxis dataKey="date" stroke="#6b7280" className="dark:stroke-gray-400" />
              <YAxis stroke="#6b7280" className="dark:stroke-gray-400" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  color: '#111827'
                }}
                wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
              />
              <Legend wrapperClassName="dark:text-gray-300" />
              <Bar dataKey="delivered" stackId="a" fill="#10b981" name="Delivered" />
              <Bar dataKey="cancelled" stackId="a" fill="#ef4444" name="Cancelled" />
              <Bar dataKey="rescheduled" stackId="a" fill="#f59e0b" name="Rescheduled" />
              <Bar dataKey="pending" stackId="a" fill="#6b7280" name="Pending" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Status Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ status, percentage }) => `${status} ${percentage}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="count"
              >
                {statusDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  color: '#111827'
                }}
                wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Daily Trend */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Daily Trend</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dailyBreakdown}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
            <XAxis dataKey="date" stroke="#6b7280" className="dark:stroke-gray-400" />
            <YAxis stroke="#6b7280" className="dark:stroke-gray-400" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                color: '#111827'
              }}
              wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
            />
            <Legend wrapperClassName="dark:text-gray-300" />
            <Line type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2} name="Delivered" />
            <Line type="monotone" dataKey="cancelled" stroke="#ef4444" strokeWidth={2} name="Cancelled" />
            <Line type="monotone" dataKey="pending" stroke="#6b7280" strokeWidth={2} name="Pending" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed Delivery List */}
      {reportData?.deliveries && reportData.deliveries.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow transition-colors">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Delivery Details</h2>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Total: {sortedDeliveries.length} delivery{sortedDeliveries.length !== 1 ? 'ies' : ''}
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => handleSort('poNumber')}
                  >
                    <div className="flex items-center gap-2">
                      PO Number
                      {sortConfig.key === 'poNumber' && (
                        sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => handleSort('customer')}
                  >
                    <div className="flex items-center gap-2">
                      Customer
                      {sortConfig.key === 'customer' && (
                        sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Address
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Delivery Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Customer Response
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Driver ID
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-2">
                      Created Date
                      {sortConfig.key === 'createdAt' && (
                        sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedDeliveries.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No deliveries found matching the filters
                    </td>
                  </tr>
                ) : (
                  paginatedDeliveries.map((delivery) => {
                    const customerStatus = getCustomerStatus(delivery);
                    const deliveryStatus = delivery.status || 'Pending';
                    
                    return (
                      <tr key={delivery.id || delivery.ID} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          {delivery.poNumber || delivery.PONumber || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            {delivery.customer || delivery.Customer || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <span className="break-words">{delivery.address || delivery.Address || 'N/A'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-gray-400" />
                            {delivery.phone || delivery.Phone || delivery.telephone1 || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(deliveryStatus)}`}>
                            {deliveryStatus}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCustomerStatusColor(customerStatus)}`}>
                            {customerStatus}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {delivery.driver_id || delivery.driverId || delivery.assignedDriverId || 'Unassigned'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-gray-400" />
                            {delivery.created_at || delivery.createdAt || delivery.created
                              ? new Date(delivery.created_at || delivery.createdAt || delivery.created).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })
                              : 'N/A'}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, sortedDeliveries.length)} of {sortedDeliveries.length} entries
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-3 py-2 text-sm rounded-lg ${
                          currentPage === pageNum
                            ? 'bg-primary-600 text-white'
                            : 'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, subtitle }) {
  const textColorClasses = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${textColorClasses[color] || 'text-gray-800 dark:text-gray-100'}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">{subtitle}</div>}
    </div>
  );
}

