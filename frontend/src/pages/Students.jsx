// Students: the list, one student's page, add, upload a class list, move / promote, classes.
// Each one is a sidebar item (see nav.js, group "Students"); they all live under /students.
import { Route, Routes } from 'react-router-dom';
import StudentReview from './StudentReview';
import StudentList from './student/StudentList';
import StudentPage from './student/StudentPage';
import AddStudent from './student/AddStudent';
import UploadList from './student/UploadList';
import MoveStudents from './student/MoveStudents';
import Classes from './student/Classes';
import ClassPage from './student/ClassPage';
import ParentRequests from './student/ParentRequests';
import BulkEdit from './student/BulkEdit';

export default function Students() {
  return (
    <Routes>
      <Route index element={<StudentList />} />
      <Route path="new" element={<AddStudent />} />
      <Route path="upload" element={<UploadList />} />
      <Route path="move" element={<MoveStudents />} />
      <Route path="bulk" element={<BulkEdit />} />
      <Route path="classes" element={<Classes />} />
      <Route path="classes/:id" element={<ClassPage />} />
      <Route path="parents" element={<ParentRequests />} />
      <Route path="review/:id" element={<StudentReview />} />
      <Route path=":id" element={<StudentPage />} />
      <Route path="*" element={<StudentList />} />
    </Routes>
  );
}
