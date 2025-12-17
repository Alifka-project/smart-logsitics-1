import React, { useEffect, useState } from 'react';
import api from '../frontend/apiClient';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: '', email: '', phone: '', full_name: '', password: '' });

  useEffect(()=>{ load(); }, []);
  async function load(){
    setLoading(true);
    try{
      const r = await api.get('/admin/drivers');
      setUsers(r.data.data || []);
    }catch(e){ console.error(e); }
    setLoading(false);
  }

  async function create(e){
    e.preventDefault();
    try{
      await api.post('/admin/drivers', form);
      setForm({ username: '', email: '', phone: '', full_name: '', password: '' });
      load();
    }catch(e){ console.error(e); }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Admin - Users</h1>
      <div className="mb-6">
        <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input placeholder="username" value={form.username} onChange={e=>setForm({...form, username:e.target.value})} className="border p-2" />
          <input placeholder="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} className="border p-2" />
          <input placeholder="phone" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} className="border p-2" />
          <input placeholder="full name" value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})} className="border p-2" />
          <input placeholder="password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})} className="border p-2" />
          <button className="bg-green-600 text-white px-4 py-2 rounded">Create</button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-2">Users</h2>
        {loading ? <div>Loading...</div> : (
          <table className="w-full bg-white rounded shadow">
            <thead><tr><th className="p-2">Username</th><th className="p-2">Full name</th><th className="p-2">Email</th></tr></thead>
            <tbody>
              {users.map(u=> (
                <tr key={u.id}><td className="p-2">{u.username}</td><td className="p-2">{u.full_name}</td><td className="p-2">{u.email}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
