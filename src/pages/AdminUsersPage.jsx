import React, { useEffect, useState } from 'react';
import api from '../frontend/apiClient';
import { 
  Users, 
  UserPlus, 
  Edit, 
  Trash2, 
  Search, 
  Filter,
  X,
  Check,
  AlertCircle,
  UserCheck,
  UserX
} from 'lucide-react';

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState('accounts');
  const [accounts, setAccounts] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    phone: '',
    full_name: '',
    password: '',
    role: 'driver',
    active: true,
    // Driver specific fields
    license_number: '',
    license_expiry: '',
    vehicle_id: ''
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/drivers');
      
      // Handle response structure: { data: [...], meta: {...} }
      const allUsers = response.data?.data || [];
      
      if (!Array.isArray(allUsers)) {
        console.error('Invalid response format:', response.data);
        setAccounts([]);
        setDrivers([]);
        return;
      }
      
      // Separate accounts and drivers based on role
      const accountsList = allUsers.filter(u => u.account?.role === 'admin');
      const driversList = allUsers.filter(u => u.account?.role === 'driver' || !u.account);
      
      setAccounts(accountsList);
      setDrivers(driversList);
    } catch (e) {
      console.error('Error loading users:', e);
      if (e.response) {
        console.error('Response status:', e.response.status);
        console.error('Response data:', e.response.data);
      }
      // Set empty arrays on error
      setAccounts([]);
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.username) newErrors.username = 'Username is required';
    if (!formData.full_name) newErrors.full_name = 'Full name is required';
    if (!formData.email && activeTab === 'accounts') newErrors.email = 'Email is required';
    if (!formData.password && !editingUser) newErrors.password = 'Password is required';
    if (activeTab === 'drivers' && !formData.license_number) {
      newErrors.license_number = 'License number is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingUser) {
        // Update existing user - use PUT for full update
        const updateData = {
          username: formData.username,
          email: formData.email,
          phone: formData.phone,
          full_name: formData.full_name,
          role: formData.role,
          active: formData.active
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        if (activeTab === 'drivers') {
          updateData.license_number = formData.license_number;
          updateData.license_expiry = formData.license_expiry;
        }
        await api.put(`/admin/drivers/${editingUser.id}`, updateData);
      } else {
        // Create new user
        const createData = {
          username: formData.username,
          email: formData.email,
          phone: formData.phone,
          full_name: formData.full_name,
          password: formData.password,
          role: formData.role,
          active: formData.active
        };
        if (activeTab === 'drivers') {
          createData.license_number = formData.license_number;
          createData.license_expiry = formData.license_expiry;
        }
        await api.post('/admin/drivers', createData);
      }
      setShowModal(false);
      resetForm();
      loadData();
    } catch (e) {
      console.error('Error saving user:', e);
      alert('Failed to save user: ' + (e?.response?.data?.error || e.message));
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
      full_name: user.fullName || user.full_name || '',
      password: '',
      role: user.account?.role || 'driver',
      active: user.active !== false,
      license_number: user.license_number || '',
      license_expiry: user.license_expiry || '',
      vehicle_id: user.vehicle_id || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      await api.delete(`/admin/drivers/${userId}`);
      loadData();
    } catch (e) {
      console.error('Error deleting user:', e);
      alert('Failed to delete user: ' + (e?.response?.data?.error || e.message));
    }
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    try {
      await api.patch(`/admin/drivers/${userId}`, { active: !currentStatus });
      loadData();
    } catch (e) {
      console.error('Error updating status:', e);
      alert('Failed to update status: ' + (e?.response?.data?.error || e.message));
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      phone: '',
      full_name: '',
      password: '',
      role: activeTab === 'accounts' ? 'admin' : 'driver',
      active: true,
      license_number: '',
      license_expiry: '',
      vehicle_id: ''
    });
    setEditingUser(null);
    setErrors({});
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const getFilteredUsers = () => {
    const users = activeTab === 'accounts' ? accounts : drivers;
    return users.filter(user => {
      const fullName = user.fullName || user.full_name || '';
      const matchesSearch = !searchTerm || 
        user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesRole = filterRole === 'all' || user.account?.role === filterRole;
      const matchesStatus = filterStatus === 'all' || 
        (filterStatus === 'active' && user.active !== false) ||
        (filterStatus === 'inactive' && user.active === false);
      
      return matchesSearch && matchesRole && matchesStatus;
    });
  };

  const filteredUsers = getFilteredUsers();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
    <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">User & Account Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage accounts, drivers, and permissions</p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
        >
          <UserPlus className="w-5 h-5" />
          Add New {activeTab === 'accounts' ? 'Account' : 'Driver'}
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'accounts', label: 'Accounts', icon: Users },
            { id: 'drivers', label: 'Drivers', icon: UserCheck }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  resetForm();
                }}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
                  ${activeTab === tab.id
                    ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-full px-2 py-0.5">
                  {tab.id === 'accounts' ? accounts.length : drivers.length}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by username, name, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="driver">Driver</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading users...</p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Contact
                    </th>
                    {activeTab === 'drivers' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        License
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                              <Users className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {user.fullName || user.full_name || user.username || 'N/A'}
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">{user.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{user.email || 'N/A'}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{user.phone || 'N/A'}</div>
                        </td>
                        {activeTab === 'drivers' && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900 dark:text-gray-100">{user.license_number || 'N/A'}</div>
                            {user.license_expiry && (
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                Exp: {new Date(user.license_expiry).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            user.account?.role === 'admin'
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                          }`}>
                            {user.account?.role || 'driver'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleStatus(user.id, user.active)}
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              user.active !== false
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                            }`}
                          >
                            {user.active !== false ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleEdit(user)}
                              className="text-primary-600 dark:text-primary-400 hover:text-primary-900 dark:hover:text-primary-300 p-2 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(user.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={activeTab === 'drivers' ? 6 : 5} className="px-6 py-12 text-center">
                        <Users className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                        <p className="text-gray-600 dark:text-gray-400">No {activeTab === 'accounts' ? 'accounts' : 'drivers'} found</p>
                        {searchTerm && (
                          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">Try adjusting your search or filters</p>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
          </table>
            </div>
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto transition-colors">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {editingUser ? 'Edit' : 'Add New'} {activeTab === 'accounts' ? 'Account' : 'Driver'}
              </h2>
              <button
                onClick={closeModal}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Personal Information */}
              <div>
                <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Personal Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Username *
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 ${
                        errors.username ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
                      }`}
                      disabled={!!editingUser}
                    />
                    {errors.username && (
                      <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.username}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 ${
                        errors.full_name ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    />
                    {errors.full_name && (
                      <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.full_name}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email {activeTab === 'accounts' && '*'}
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 ${
                        errors.email ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    />
                    {errors.email && (
                      <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.email}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>

              {/* Driver Specific Fields */}
              {activeTab === 'drivers' && (
                <div>
                  <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Driver Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        License Number *
                      </label>
                      <input
                        type="text"
                        value={formData.license_number}
                        onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 ${
                          errors.license_number ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                      {errors.license_number && (
                        <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.license_number}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        License Expiry
                      </label>
                      <input
                        type="date"
                        value={formData.license_expiry}
                        onChange={(e) => setFormData({ ...formData, license_expiry: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Account Settings */}
              <div>
                <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Account Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Role *
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {editingUser ? 'New Password (leave blank to keep current)' : 'Password *'}
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 ${
                        errors.password ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    />
                    {errors.password && (
                      <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.password}</p>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.active}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
                  </label>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  {editingUser ? 'Update' : 'Create'} {activeTab === 'accounts' ? 'Account' : 'Driver'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
