import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import DiaryList from './pages/DiaryList'
import DiaryDetail from './pages/DiaryDetail'
import PhotoWall from './pages/PhotoWall'
import Timeline from './pages/Timeline'
import AdminLayout from './pages/Admin/AdminLayout'
import AdminLogin from './pages/Admin/Login'
import AdminDashboard from './pages/Admin/Dashboard'
import AdminDiaries from './pages/Admin/Diaries'
import AdminNewDiary from './pages/Admin/NewDiary'
import AdminDiaryEditor from './pages/Admin/DiaryEditor'
import AdminPhotos from './pages/Admin/Photos'
import AdminSettings from './pages/Admin/Settings'
import AdminLogs from './pages/Admin/Logs'
import AdminData from './pages/Admin/Data'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/diaries" element={<DiaryList />} />
      <Route path="/diaries/:id" element={<DiaryDetail />} />
      <Route path="/photos" element={<PhotoWall />} />
      <Route path="/timeline" element={<Timeline />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="diaries" element={<AdminDiaries />} />
        <Route path="diaries/new" element={<AdminNewDiary />} />
        <Route path="diaries/:id/edit" element={<AdminDiaryEditor />} />
        <Route path="photos" element={<AdminPhotos />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="logs" element={<AdminLogs />} />
        <Route path="data" element={<AdminData />} />
      </Route>
    </Routes>
  )
}
